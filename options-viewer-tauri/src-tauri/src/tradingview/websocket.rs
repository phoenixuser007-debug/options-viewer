use crate::commands::types::OHLCBar;
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use serde_json::Value;
use std::time::Duration;
use tokio::time::timeout;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

const WS_URL: &str = "wss://data.tradingview.com/socket.io/websocket";

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

fn parse_response(data: &str) -> Vec<Value> {
    let mut messages = Vec::new();
    let mut pos = 0;
    
    while pos < data.len() {
        if !data[pos..].starts_with("~m~") {
            break;
        }
        
        let len_start = pos + 3;
        let len_end = data[len_start..].find("~m~").map(|i| len_start + i);
        
        if let Some(len_end) = len_end {
            if let Ok(len) = data[len_start..len_end].parse::<usize>() {
                let msg_start = len_end + 3;
                let msg_end = msg_start + len;
                
                if msg_end <= data.len() {
                    let message = &data[msg_start..msg_end];
                    
                    if !message.starts_with("~h~") {
                        if let Ok(parsed) = serde_json::from_str(message) {
                            messages.push(parsed);
                        }
                    }
                    
                    pos = msg_end;
                } else {
                    break;
                }
            } else {
                break;
            }
        } else {
            break;
        }
    }
    
    messages
}

fn send_message(method: &str, params: &[&str]) -> String {
    let params_json: Vec<Value> = params.iter().map(|p| Value::String(p.to_string())).collect();
    let message = serde_json::json!({
        "m": method,
        "p": params_json
    });
    add_prefix_message(&message.to_string())
}

fn send_message_with_values(method: &str, params: Vec<Value>) -> String {
    let message = serde_json::json!({
        "m": method,
        "p": params
    });
    add_prefix_message(&message.to_string())
}

/// Fetch OHLC data with configurable timeframe
/// timeframe: "D" for daily, "15" for 15 minutes, "60" for hourly, etc.
pub async fn fetch_ohlc_with_timeframe(symbol: &str, bars: i32, timeframe: &str) -> Result<Vec<OHLCBar>, String> {
    let session_id = generate_session_id("cs");
    let sds_id = "sds_1";
    let sds_sym_id = "sds_sym_1";
    
    let mut request = WS_URL.into_client_request()
        .map_err(|e| format!("Failed to create request: {}", e))?;
    
    let headers = request.headers_mut();
    headers.insert("Origin", "https://www.tradingview.com".parse().unwrap());
    headers.insert("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36".parse().unwrap());
    
    log::info!("Connecting to TradingView WebSocket for symbol: {} ({})", symbol, timeframe);
    
    let (ws_stream, _) = connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;
    
    log::info!("WebSocket connected successfully");
    
    let (mut write, mut read) = ws_stream.split();
    
    let auth_msg = send_message("set_auth_token", &["unauthorized_user_token"]);
    write.send(Message::Text(auth_msg)).await.map_err(|e| format!("Send failed: {}", e))?;
    
    let session_msg = send_message("chart_create_session", &[&session_id, ""]);
    write.send(Message::Text(session_msg)).await.map_err(|e| format!("Send failed: {}", e))?;
    
    tokio::time::sleep(Duration::from_millis(100)).await;
    
    let symbol_resolve = format!(r#"={{"symbol":"{}","adjustment":"splits","session":"extended"}}"#, symbol);
    let resolve_msg = send_message("resolve_symbol", &[&session_id, sds_sym_id, &symbol_resolve]);
    write.send(Message::Text(resolve_msg)).await.map_err(|e| format!("Send failed: {}", e))?;
    
    tokio::time::sleep(Duration::from_millis(500)).await;
    
    let series_msg = send_message_with_values("create_series", vec![
        Value::String(session_id.clone()),
        Value::String(sds_id.to_string()),
        Value::String("s1".to_string()),
        Value::String(sds_sym_id.to_string()),
        Value::String(timeframe.to_string()),
        Value::Number(bars.into()),
        Value::String("".to_string()),
    ]);
    write.send(Message::Text(series_msg)).await.map_err(|e| format!("Send failed: {}", e))?;
    
    let mut ohlc_data: Vec<OHLCBar> = Vec::new();
    
    let result = timeout(Duration::from_secs(15), async {
        while let Some(msg_result) = read.next().await {
            match msg_result {
                Ok(Message::Text(text)) => {
                    if text.contains("~h~") {
                        let parts: Vec<&str> = text.split("~h~").collect();
                        if parts.len() > 1 {
                            let heartbeat = format!("~m~3~m~~h~{}", parts.last().unwrap_or(&""));
                            let _ = write.send(Message::Text(heartbeat)).await;
                        }
                    }
                    
                    let messages = parse_response(&text);
                    
                    for msg in messages {
                        if let Some(method) = msg.get("m").and_then(|m| m.as_str()) {
                            if method == "timescale_update" {
                                if let Some(payload) = msg.get("p").and_then(|p| p.get(1)) {
                                    if let Some(obj) = payload.as_object() {
                                        for (_, value) in obj {
                                            if let Some(series) = value.get("s").and_then(|s| s.as_array()) {
                                                for bar in series {
                                                    if let Some(v) = bar.get("v").and_then(|v| v.as_array()) {
                                                        if v.len() >= 5 {
                                                            ohlc_data.push(OHLCBar {
                                                                timestamp: v[0].as_f64().unwrap_or(0.0) as i64,
                                                                open: v[1].as_f64().unwrap_or(0.0),
                                                                high: v[2].as_f64().unwrap_or(0.0),
                                                                low: v[3].as_f64().unwrap_or(0.0),
                                                                close: v[4].as_f64().unwrap_or(0.0),
                                                                volume: v.get(5).and_then(|v| v.as_f64()),
                                                            });
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            } else if method == "series_completed" {
                                log::info!("Series completed, received {} bars", ohlc_data.len());
                                return Ok(ohlc_data.clone());
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("WebSocket read error: {}", e);
                    break;
                }
                _ => {}
            }
        }
        Ok(ohlc_data.clone())
    }).await;
    
    match result {
        Ok(Ok(mut data)) => {
            data.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
            log::info!("Returning {} OHLC bars ({})", data.len(), timeframe);
            Ok(data)
        }
        Ok(Err(e)) => Err(e),
        Err(_) => {
            if !ohlc_data.is_empty() {
                ohlc_data.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
                log::info!("Timeout but returning {} OHLC bars", ohlc_data.len());
                Ok(ohlc_data)
            } else {
                Err("Timeout: No data received".to_string())
            }
        }
    }
}
