use crate::commands::types::*;
use reqwest::Client;

const TRADINGVIEW_OPTIONS_URL: &str = "https://scanner.tradingview.com/options/scan2?label-product=options-builder";
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

#[tauri::command]
pub async fn fetch_options(symbol: String, expiration: i64) -> Result<OptionsResponse, String> {
    let client = Client::new();
    
    // Parse symbol - could be "NIFTY" or "NSE:NIFTY"
    let (exchange, root) = if symbol.contains(':') {
        let parts: Vec<&str> = symbol.split(':').collect();
        (parts[0].to_string(), parts[1].to_string())
    } else {
        ("NSE".to_string(), symbol.to_uppercase())
    };
    
    let underlying = format!("{}:{}", exchange, root);
    
    let payload = serde_json::json!({
        "columns": ["ask", "bid", "currency", "delta", "expiration", "gamma", "iv", "option-type", "pricescale", "rho", "root", "strike", "theoPrice", "theta", "vega", "bid_iv", "ask_iv"],
        "filter": [
            { "left": "type", "operation": "equal", "right": "option" },
            { "left": "expiration", "operation": "equal", "right": expiration },
            { "left": "root", "operation": "equal", "right": root }
        ],
        "ignore_unknown_fields": false,
        "index_filters": [{ "name": "underlying_symbol", "values": [underlying] }]
    });

    let response = client
        .post(TRADINGVIEW_OPTIONS_URL)
        .header("accept", "application/json")
        .header("accept-language", "en-GB,en;q=0.8")
        .header("content-type", "text/plain;charset=UTF-8")
        .header("origin", "https://www.tradingview.com")
        .header("referer", "https://www.tradingview.com/")
        .header("user-agent", USER_AGENT)
        .body(payload.to_string())
        .send()
        .await
        .map_err(|e| format!("Failed to fetch options: {}", e))?;

    let data: OptionsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse options response: {}", e))?;

    Ok(data)
}
