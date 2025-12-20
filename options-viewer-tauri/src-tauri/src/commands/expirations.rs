use crate::commands::types::*;
use chrono::{Datelike, Local, NaiveDate};
use reqwest::Client;
use std::collections::HashSet;

const TRADINGVIEW_OPTIONS_URL: &str = "https://scanner.tradingview.com/options/scan2?label-product=options-builder";
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const MONTH_NAMES: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

fn format_expiration(exp: i64) -> ExpirationInfo {
    let exp_str = exp.to_string();
    let year = &exp_str[0..4];
    let month = &exp_str[4..6];
    let day = &exp_str[6..8];
    
    let formatted = format!("{}/{}/{}", day, month, year);
    
    // Parse date to get day of week
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

#[tauri::command]
pub async fn fetch_expirations(symbol: String) -> Result<ExpirationsResponse, String> {
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
        "columns": ["expiration"],
        "filter": [
            { "left": "type", "operation": "equal", "right": "option" },
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
        .map_err(|e| format!("Failed to fetch expirations: {}", e))?;

    let data: OptionsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse expirations response: {}", e))?;

    // Extract unique expiration dates
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

    // Sort expirations
    let mut sorted_expirations: Vec<i64> = expirations.into_iter().collect();
    sorted_expirations.sort();

    // Get current date info
    let now = Local::now();
    let current_year = now.year();
    let current_month = now.month();
    let next_month = if current_month == 12 { 1 } else { current_month + 1 };
    let next_month_year = if current_month == 12 { current_year + 1 } else { current_year };

    // Filter expirations by month
    let current_month_expirations: Vec<ExpirationInfo> = sorted_expirations
        .iter()
        .filter(|exp| {
            let exp_str = exp.to_string();
            let exp_year: i32 = exp_str[0..4].parse().unwrap_or(0);
            let exp_month: u32 = exp_str[4..6].parse().unwrap_or(0);
            exp_year == current_year && exp_month == current_month
        })
        .map(|exp| format_expiration(*exp))
        .collect();

    let next_month_expirations: Vec<ExpirationInfo> = sorted_expirations
        .iter()
        .filter(|exp| {
            let exp_str = exp.to_string();
            let exp_year: i32 = exp_str[0..4].parse().unwrap_or(0);
            let exp_month: u32 = exp_str[4..6].parse().unwrap_or(0);
            exp_year == next_month_year && exp_month == next_month
        })
        .map(|exp| format_expiration(*exp))
        .collect();

    let all_expirations: Vec<ExpirationInfo> = sorted_expirations
        .iter()
        .map(|exp| format_expiration(*exp))
        .collect();

    Ok(ExpirationsResponse {
        current_month: ExpirationsMonth {
            month: current_month,
            month_name: MONTH_NAMES[(current_month - 1) as usize].to_string(),
            year: current_year,
            count: current_month_expirations.len(),
            expirations: current_month_expirations,
        },
        next_month: ExpirationsMonth {
            month: next_month,
            month_name: MONTH_NAMES[(next_month - 1) as usize].to_string(),
            year: next_month_year,
            count: next_month_expirations.len(),
            expirations: next_month_expirations,
        },
        all: all_expirations,
    })
}
