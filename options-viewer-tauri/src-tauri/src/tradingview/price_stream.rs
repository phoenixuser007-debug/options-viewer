use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const WS_URL: &str = "wss://data.tradingview.com/socket.io/websocket";

#[derive(Clone, Serialize, Debug)]
pub struct PriceUpdate {
    pub symbol: String,
    pub price: f64,
    pub bid: Option<f64>,
    pub ask: Option<f64>,
    pub delta: Option<f64>,
    pub gamma: Option<f64>,
    pub theta: Option<f64>,
    pub vega: Option<f64>,
    pub rho: Option<f64>,
    pub iv: Option<f64>,
    pub change: f64,
    pub change_abs: f64,
    pub high: f64,
    pub low: f64,
    pub open: f64,
    pub volume: f64,
}

struct StreamTask {
    stop_tx: watch::Sender<bool>,
    handle: JoinHandle<()>,
}

pub struct PriceStreamer {
    app_handle: AppHandle,
    task: Mutex<Option<StreamTask>>,
}

impl PriceStreamer {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            task: Mutex::new(None),
        }
    }

    pub async fn start(&self, symbols: Vec<String>) {
        self.stop().await;

        let app_handle = self.app_handle.clone();
        let tickers = normalize_symbols(symbols);
        if tickers.is_empty() {
            return;
        }
        let (stop_tx, stop_rx) = watch::channel(false);

        let handle = tokio::spawn(async move {
            run_price_stream(app_handle, tickers, stop_rx).await;
        });

        let mut task = self.task.lock().await;
        *task = Some(StreamTask { stop_tx, handle });
    }

    pub async fn stop(&self) {
        let existing = {
            let mut task = self.task.lock().await;
            task.take()
        };

        if let Some(stream_task) = existing {
            let _ = stream_task.stop_tx.send(true);
            let _ = stream_task.handle.await;
        }
    }
}

pub struct PriceStreamManager {
    streamer: tokio::sync::RwLock<Option<Arc<PriceStreamer>>>,
}

impl PriceStreamManager {
    pub fn new() -> Self {
        Self {
            streamer: tokio::sync::RwLock::new(None),
        }
    }

    async fn get_or_init_streamer(&self, app_handle: AppHandle) -> Arc<PriceStreamer> {
        {
            let s = self.streamer.read().await;
            if let Some(streamer) = s.as_ref() {
                return streamer.clone();
            }
        }

        let mut s = self.streamer.write().await;
        if let Some(streamer) = s.as_ref() {
            return streamer.clone();
        }

        let streamer = Arc::new(PriceStreamer::new(app_handle));
        *s = Some(streamer.clone());
        streamer
    }

    pub async fn start(&self, symbols: Vec<String>, app_handle: AppHandle) {
        let streamer = self.get_or_init_streamer(app_handle).await;
        streamer.start(symbols).await;
    }

    pub async fn stop(&self) {
        let streamer = {
            let s = self.streamer.read().await;
            s.clone()
        };

        if let Some(streamer) = streamer {
            streamer.stop().await;
        }
    }
}

impl Default for PriceStreamManager {
    fn default() -> Self {
        Self::new()
    }
}

async fn run_price_stream(app_handle: AppHandle, tickers: Vec<String>, mut stop_rx: watch::Receiver<bool>) {
    let primary = tickers.first().cloned().unwrap_or_else(|| "UNKNOWN".to_string());
    loop {
        if *stop_rx.borrow() {
            return;
        }

        match connect_and_stream(&app_handle, &tickers, &mut stop_rx).await {
            Ok(()) => return,
            Err(err) => {
                log::error!("Price stream error for {}: {}", primary, err);
                let _ = app_handle.emit("price-error", err);
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            return;
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                }
            }
        }
    }
}

async fn connect_and_stream(
    app_handle: &AppHandle,
    tickers: &[String],
    stop_rx: &mut watch::Receiver<bool>,
) -> Result<(), String> {
    let primary = tickers
        .first()
        .cloned()
        .unwrap_or_else(|| "UNKNOWN".to_string());
    log::info!("Opening TradingView quote stream for {} symbols (primary {})", tickers.len(), primary);
    let session_id = generate_session_id("qs");

    let mut request = WS_URL
        .into_client_request()
        .map_err(|e| format!("Failed to create request: {}", e))?;

    let headers = request.headers_mut();
    headers.insert(
        "Origin",
        "https://www.tradingview.com"
            .parse()
            .map_err(|e| format!("Failed to set origin header: {}", e))?,
    );
    headers.insert(
        "User-Agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            .parse()
            .map_err(|e| format!("Failed to set user-agent header: {}", e))?,
    );

    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;
    log::info!("TradingView WS connected for {}", primary);

    let (mut write, mut read) = ws_stream.split();

    // Wait briefly for the server to send its initial handshake before sending
    // commands — mirrors the time.sleep(2) used in Python implementations.
    tokio::time::sleep(Duration::from_millis(500)).await;

    let auth_msg = send_message("set_auth_token", &["unauthorized_user_token"]);
    write.send(Message::Text(auth_msg)).await.map_err(|e| format!("Auth send failed: {}", e))?;

    let create_session = send_message("quote_create_session", &[&session_id]);
    write.send(Message::Text(create_session)).await.map_err(|e| format!("quote_create_session failed: {}", e))?;

    let set_fields = send_message(
        "quote_set_fields",
        &[
            &session_id,
            "lp",
            "bid",
            "ask",
            "delta",
            "gamma",
            "theta",
            "vega",
            "rho",
            "iv",
            "ch",
            "chp",
            "open_price",
            "high_price",
            "low_price",
            "volume",
        ],
    );
    write
        .send(Message::Text(set_fields))
        .await
        .map_err(|e| format!("quote_set_fields failed: {}", e))?;

    // No force_permission flag — it causes invalid_parameters for NSE indices
    for ticker in tickers {
        let add_symbol = send_message("quote_add_symbols", &[&session_id, ticker]);
        write.send(Message::Text(add_symbol)).await.map_err(|e| format!("quote_add_symbols failed for {}: {}", ticker, e))?;
    }

    log::info!("Subscribed to quote updates for {} symbols", tickers.len());

    loop {
        tokio::select! {
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    return Ok(());
                }
            }
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_heartbeat(&text, &mut write).await;
                        let messages = parse_framed_messages(&text);
                        for message in messages {
                            let method = message.get("m").and_then(|m| m.as_str()).unwrap_or("unknown");
                            if method == "qsd" {
                                log::info!("[qsd] {}", message);
                            }
                            if let Some(update) = extract_price_update(&message) {
                                log::info!(
                                    "Price update {} => price={} bid={:?} ask={:?} delta={:?} gamma={:?} theta={:?} vega={:?} rho={:?} iv={:?}",
                                    update.symbol,
                                    update.price,
                                    update.bid,
                                    update.ask,
                                    update.delta,
                                    update.gamma,
                                    update.theta,
                                    update.vega,
                                    update.rho,
                                    update.iv
                                );
                                let _ = app_handle.emit("price-update", update);
                            }
                        }
                    }
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return Err(format!("WebSocket read error: {}", e)),
                    None => return Err("WebSocket closed by remote".to_string()),
                }
            }
        }
    }
}

fn normalize_symbols(symbols: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for symbol in symbols {
        let normalized = if symbol.contains(':') {
            symbol.to_uppercase()
        } else {
            format!("NSE:{}", symbol.to_uppercase())
        };
        if !out.contains(&normalized) {
            out.push(normalized);
        }
    }
    out
}

fn generate_session_id(prefix: &str) -> String {
    let random_string: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(12)
        .map(|c| c.to_ascii_lowercase() as char)
        .collect();
    format!("{}_{}", prefix, random_string)
}

fn add_prefix_message(msg: &str) -> String {
    format!("~m~{}~m~{}", msg.len(), msg)
}

fn send_message(method: &str, params: &[&str]) -> String {
    let params_json: Vec<Value> = params.iter().map(|p| Value::String((*p).to_string())).collect();
    let message = serde_json::json!({
        "m": method,
        "p": params_json,
    });
    add_prefix_message(&message.to_string())
}

fn send_message_with_values(method: &str, params: Vec<Value>) -> String {
    let message = serde_json::json!({
        "m": method,
        "p": params,
    });
    add_prefix_message(&message.to_string())
}

fn parse_framed_messages(data: &str) -> Vec<Value> {
    parse_framed_payloads(data)
        .into_iter()
        .filter(|payload| !payload.starts_with("~h~"))
        .filter_map(|payload| serde_json::from_str::<Value>(&payload).ok())
        .collect()
}

fn parse_framed_payloads(data: &str) -> Vec<String> {
    let mut messages = Vec::new();
    let mut pos = 0;

    while pos < data.len() {
        if !data[pos..].starts_with("~m~") {
            break;
        }

        let len_start = pos + 3;
        let Some(len_sep_offset) = data[len_start..].find("~m~") else {
            break;
        };

        let len_end = len_start + len_sep_offset;
        let Ok(payload_len) = data[len_start..len_end].parse::<usize>() else {
            break;
        };

        let msg_start = len_end + 3;
        let msg_end = msg_start + payload_len;
        if msg_end > data.len() {
            break;
        }

        let payload = data[msg_start..msg_end].to_string();
        messages.push(payload);

        pos = msg_end;
    }

    messages
}

fn build_heartbeat_ack(token: &str) -> String {
    let payload = format!("~h~{}", token);
    add_prefix_message(&payload)
}

fn extract_price_update(message: &Value) -> Option<PriceUpdate> {
    let method = message.get("m")?.as_str()?;
    if method != "qsd" {
        return None;
    }

    let params = message.get("p")?.as_array()?;
    if params.len() < 2 {
        return None;
    }

    // p[0] = session_id, p[1] = {"n": symbol, "s": status, "v": values}
    let data = params[1].as_object()?;
    let symbol = data.get("n")?.as_str()?.to_string();
    let values = data.get("v")?;

    let bid = values.get("bid").and_then(Value::as_f64);
    let ask = values.get("ask").and_then(Value::as_f64);
    let price = values.get("lp").and_then(Value::as_f64);
    let delta = values.get("delta").and_then(Value::as_f64);
    let gamma = values.get("gamma").and_then(Value::as_f64);
    let theta = values.get("theta").and_then(Value::as_f64);
    let vega = values.get("vega").and_then(Value::as_f64);
    let rho = values.get("rho").and_then(Value::as_f64);
    let iv = values.get("iv").and_then(Value::as_f64);

    // Skip updates that carry none of the fields we care about
    if price.is_none()
        && bid.is_none()
        && ask.is_none()
        && delta.is_none()
        && gamma.is_none()
        && theta.is_none()
        && vega.is_none()
        && rho.is_none()
        && iv.is_none()
    {
        return None;
    }

    let price = price.unwrap_or(0.0);
    let change_abs = values.get("ch").and_then(Value::as_f64).unwrap_or(0.0);
    let change = values.get("chp").and_then(Value::as_f64).unwrap_or(0.0);
    let open = values.get("open_price").and_then(Value::as_f64).unwrap_or(0.0);
    let high = values.get("high_price").and_then(Value::as_f64).unwrap_or(0.0);
    let low = values.get("low_price").and_then(Value::as_f64).unwrap_or(0.0);
    let volume = values.get("volume").and_then(Value::as_f64).unwrap_or(0.0);

    Some(PriceUpdate {
        symbol,
        price,
        bid,
        ask,
        delta,
        gamma,
        theta,
        vega,
        rho,
        iv,
        change,
        change_abs,
        high,
        low,
        open,
        volume,
    })
}

async fn handle_heartbeat<W>(text: &str, write: &mut W)
where
    W: SinkExt<Message> + Unpin,
{
    for payload in parse_framed_payloads(text) {
        if let Some(token) = payload.strip_prefix("~h~") {
            let heartbeat = build_heartbeat_ack(token);
            let _ = write.send(Message::Text(heartbeat)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_framed_messages_extracts_json_payloads() {
        let payload = r#"{"m":"qsd","p":["qs_1","NSE:NIFTY",{"v":{"lp":123.45}}]}"#;
        let framed = format!("~m~{}~m~{}", payload.len(), payload);

        let messages = parse_framed_messages(&framed);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].get("m").and_then(Value::as_str), Some("qsd"));
    }

    #[test]
    fn parse_framed_payloads_keeps_heartbeat_payloads() {
        let hb = "~h~424242";
        let framed = format!("~m~{}~m~{}", hb.len(), hb);

        let payloads = parse_framed_payloads(&framed);
        assert_eq!(payloads, vec![hb.to_string()]);
    }

    #[test]
    fn build_heartbeat_ack_uses_correct_dynamic_length() {
        let ack = build_heartbeat_ack("424242");
        assert_eq!(ack, "~m~9~m~~h~424242");
    }

    #[test]
    fn extract_price_update_maps_quote_payload() {
        let message = serde_json::json!({
            "m": "qsd",
            "p": [
                "qs_abc",
                {"n": "NSE:NIFTY", "s": "ok", "v": {
                    "lp": 20000.5,
                    "ch": 50.25,
                    "chp": 0.25,
                    "volume": 1200000.0
                }}
            ]
        });

        let update = extract_price_update(&message).expect("expected valid price update");
        assert_eq!(update.symbol, "NSE:NIFTY");
        assert_eq!(update.price, 20000.5);
        assert_eq!(update.bid, None);
        assert_eq!(update.ask, None);
        assert_eq!(update.delta, None);
        assert_eq!(update.gamma, None);
        assert_eq!(update.theta, None);
        assert_eq!(update.vega, None);
        assert_eq!(update.rho, None);
        assert_eq!(update.iv, None);
        assert_eq!(update.change_abs, 50.25);
        assert_eq!(update.change, 0.25);
    }

    #[test]
    fn extract_price_update_accepts_bid_ask_without_lp() {
        let message = serde_json::json!({
            "m": "qsd",
            "p": [
                "qs_abc",
                {"n": "NSE:NIFTY260320C23000", "s": "ok", "v": {
                    "bid": 120.5,
                    "ask": 121.0
                }}
            ]
        });

        let update = extract_price_update(&message).expect("option update with only bid/ask should be accepted");
        assert_eq!(update.symbol, "NSE:NIFTY260320C23000");
        assert_eq!(update.price, 0.0);
        assert_eq!(update.bid, Some(120.5));
        assert_eq!(update.ask, Some(121.0));
        assert_eq!(update.delta, None);
        assert_eq!(update.gamma, None);
        assert_eq!(update.theta, None);
        assert_eq!(update.vega, None);
        assert_eq!(update.rho, None);
        assert_eq!(update.iv, None);
    }

    #[test]
    fn extract_price_update_accepts_greeks_without_lp_bid_ask() {
        let message = serde_json::json!({
            "m": "qsd",
            "p": [
                "qs_abc",
                {"n": "NSE:NIFTY260320C23000", "s": "ok", "v": {
                    "delta": 0.45,
                    "gamma": 0.001,
                    "theta": -12.3,
                    "vega": 8.7,
                    "rho": 0.03,
                    "iv": 14.5
                }}
            ]
        });

        let update = extract_price_update(&message).expect("option update with only greeks should be accepted");
        assert_eq!(update.symbol, "NSE:NIFTY260320C23000");
        assert_eq!(update.price, 0.0);
        assert_eq!(update.bid, None);
        assert_eq!(update.ask, None);
        assert_eq!(update.delta, Some(0.45));
        assert_eq!(update.gamma, Some(0.001));
        assert_eq!(update.theta, Some(-12.3));
        assert_eq!(update.vega, Some(8.7));
        assert_eq!(update.rho, Some(0.03));
        assert_eq!(update.iv, Some(14.5));
    }

    #[test]
    fn extract_price_update_rejects_update_with_no_useful_fields() {
        let message = serde_json::json!({
            "m": "qsd",
            "p": ["qs_abc", {"n": "NSE:NIFTY", "s": "ok", "v": {"volume": 1000.0}}]
        });

        assert!(extract_price_update(&message).is_none());
    }
}
