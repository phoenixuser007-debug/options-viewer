use crate::commands::types::*;
use reqwest::Client;

const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

#[tauri::command]
pub async fn fetch_price(symbol: String) -> Result<PriceResponse, String> {
    let client = Client::new();

    // Parse symbol - could be "NIFTY" or "NSE:NIFTY"
    let ticker = if symbol.contains(':') {
        symbol.to_uppercase()
    } else {
        format!("NSE:{}", symbol.to_uppercase())
    };

    let payload = serde_json::json!({
        "symbols": { "tickers": [ticker] },
        "columns": ["close", "change", "change_abs", "high", "low", "open", "volume"]
    });

    let response = client
        .post("https://scanner.tradingview.com/india/scan")
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .header("origin", "https://www.tradingview.com")
        .header("referer", "https://www.tradingview.com/")
        .header("user-agent", USER_AGENT)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch price: {}", e))?;

    let data: ScannerResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse price response: {}", e))?;

    if let Some(items) = data.data {
        if let Some(item) = items.first() {
            if item.d.len() >= 7 {
                return Ok(PriceResponse {
                    price: item.d[0],
                    change: item.d[1],
                    change_abs: item.d[2],
                    high: item.d[3],
                    low: item.d[4],
                    open: item.d[5],
                    volume: item.d[6],
                });
            }
        }
    }

    Err(format!("Price not found for {}", symbol))
}
