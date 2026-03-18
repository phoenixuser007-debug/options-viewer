mod commands;
mod tradingview;

use commands::{fetch_options, fetch_price, fetch_expirations, fetch_option_ohlc, search_symbol, start_price_stream, stop_price_stream, AppState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new();
    
    tauri::Builder::default()
        .manage(app_state)
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_options,
            fetch_price,
            fetch_expirations,
            fetch_option_ohlc,
            search_symbol,
            start_price_stream,
            stop_price_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
