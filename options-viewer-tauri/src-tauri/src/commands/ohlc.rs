use crate::commands::types::OHLCResponse;
use crate::tradingview::websocket::fetch_ohlc_with_timeframe;

#[tauri::command]
pub async fn fetch_option_ohlc(symbol: String, bars: i32, timeframe: String) -> Result<OHLCResponse, String> {
    log::info!("Fetching {} OHLC bars ({}) for option: {}", bars, timeframe, symbol);
    
    // Validate timeframe
    let tf = match timeframe.as_str() {
        "5" | "15" | "30" | "60" | "D" => timeframe.as_str(),
        _ => "15", // Default to 15m
    };
    
    // Fetch data for the specified timeframe
    let ohlc_data = fetch_ohlc_with_timeframe(&symbol, bars, tf).await?;
    
    // Fetch daily data for pivot calculation
    // Get enough daily bars to cover all the intraday data
    let daily_data = fetch_ohlc_with_timeframe(&symbol, 100, "D").await
        .unwrap_or_else(|e| {
            log::warn!("Failed to fetch daily data for pivots: {}", e);
            Vec::new()
        });
    
    log::info!("Successfully fetched {} bars ({}) and {} daily bars for {}", 
        ohlc_data.len(), tf, daily_data.len(), symbol);
    
    Ok(OHLCResponse {
        symbol,
        bars_count: ohlc_data.len(),
        ohlc_data,
        daily_data,
    })
}
