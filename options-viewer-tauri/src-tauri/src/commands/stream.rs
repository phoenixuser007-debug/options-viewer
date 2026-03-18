use crate::tradingview::price_stream::PriceStreamManager;
use std::sync::Arc;
use tauri::{AppHandle, State};

pub struct AppState {
    pub price_stream: Arc<PriceStreamManager>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            price_stream: Arc::new(PriceStreamManager::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn start_price_stream(
    app_handle: AppHandle,
    symbols: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("Starting price stream for {} symbols", symbols.len());
    state.price_stream.start(symbols, app_handle).await;
    Ok(())
}

#[tauri::command]
pub async fn stop_price_stream(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("Stopping price stream");
    state.price_stream.stop().await;
    Ok(())
}
