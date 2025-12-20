use crate::commands::types::*;
use chrono::{Datelike, Local, NaiveDate};
use reqwest::Client;
use std::collections::HashSet;

const TRADINGVIEW_OPTIONS_URL: &str = "https://scanner.tradingview.com/options/scan2?label-product=options-builder";
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

fn format_expiration(exp: i64) -> ExpirationInfo {
    let exp_str = exp.to_string();
    let year = &exp_str[0..4];
    let month = &exp_str[4..6];
    let day = &exp_str[6..8];
    
    let formatted = format!("{}/{}/{}", day, month, year);
    
    let date = NaiveDate::parse_from_str(&exp_str, "%Y%m%d")
        .map(|d| d.weekday().to_string())
        .unwrap_or_else(|_| "".to_string());
    
    let day_of_week = match date.as_str() {
        "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun" => date[..3].to_string(),
        _ => "".to_string(),
    };
    
    ExpirationInfo {
        value: exp,
        formatted,
        day_of_week,
    }
}

/// Search for symbols that have options available
/// Queries TradingView to check if the symbol has options contracts
#[tauri::command]
pub async fn search_symbol(query: String) -> Result<SymbolSearchResponse, String> {
    let query = query.trim().to_uppercase();
    
    if query.len() < 3 {
        return Err("Query must be at least 3 characters".to_string());
    }

    let client = Client::new();
    
    // Try NSE first (most common for Indian options)
    let exchanges = vec!["NSE", "BSE"];
    let mut results: Vec<SymbolSearchResult> = Vec::new();
    
    for exchange in exchanges {
        let underlying = format!("{}:{}", exchange, query);
        
        let payload = serde_json::json!({
            "columns": ["expiration"],
            "filter": [
                { "left": "type", "operation": "equal", "right": "option" },
                { "left": "root", "operation": "equal", "right": query }
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
            .await;

        if let Ok(resp) = response {
            if let Ok(data) = resp.json::<OptionsResponse>().await {
                // Extract unique expirations
                let mut expirations: HashSet<i64> = HashSet::new();
                
                if let Some(symbols) = &data.symbols {
                    for symbol in symbols {
                        if let Some(exp) = symbol.f.first() {
                            if let Some(exp_val) = exp.as_i64() {
                                expirations.insert(exp_val);
                            }
                        }
                    }
                }

                if !expirations.is_empty() {
                    let mut sorted_expirations: Vec<i64> = expirations.into_iter().collect();
                    sorted_expirations.sort();
                    
                    // Filter to only future expirations
                    let now = Local::now();
                    let today = now.format("%Y%m%d").to_string().parse::<i64>().unwrap_or(0);
                    
                    let future_expirations: Vec<ExpirationInfo> = sorted_expirations
                        .into_iter()
                        .filter(|exp| *exp >= today)
                        .map(|exp| format_expiration(exp))
                        .collect();

                    if !future_expirations.is_empty() {
                        results.push(SymbolSearchResult {
                            symbol: query.clone(),
                            underlying: underlying.clone(),
                            exchange: exchange.to_string(),
                            has_options: true,
                            expiration_count: future_expirations.len(),
                            expirations: future_expirations,
                        });
                        
                        // Found options on this exchange, no need to check others
                        break;
                    }
                }
            }
        }
    }

    Ok(SymbolSearchResponse {
        results,
        query,
    })
}
