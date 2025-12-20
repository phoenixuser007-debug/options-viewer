use serde::{Deserialize, Serialize};

// Options data structures
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OptionsResponse {
    pub symbols: Option<Vec<OptionSymbol>>,
    pub fields: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OptionSymbol {
    pub s: String,
    pub f: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OptionsPayload {
    pub columns: Vec<String>,
    pub filter: Vec<FilterItem>,
    pub ignore_unknown_fields: bool,
    pub index_filters: Vec<IndexFilter>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FilterItem {
    pub left: String,
    pub operation: String,
    pub right: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IndexFilter {
    pub name: String,
    pub values: Vec<String>,
}

// Price data
#[derive(Debug, Serialize, Deserialize)]
pub struct PriceResponse {
    pub price: f64,
    pub change: f64,
    pub change_abs: f64,
    pub high: f64,
    pub low: f64,
    pub open: f64,
    pub volume: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScannerRequest {
    pub symbols: ScannerSymbols,
    pub columns: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScannerSymbols {
    pub tickers: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScannerResponse {
    pub data: Option<Vec<ScannerDataItem>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScannerDataItem {
    pub s: String,
    pub d: Vec<f64>,
}

// Expirations
#[derive(Debug, Serialize, Deserialize)]
pub struct ExpirationInfo {
    pub value: i64,
    pub formatted: String,
    pub day_of_week: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExpirationsMonth {
    pub month: u32,
    pub month_name: String,
    pub year: i32,
    pub count: usize,
    pub expirations: Vec<ExpirationInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExpirationsResponse {
    pub current_month: ExpirationsMonth,
    pub next_month: ExpirationsMonth,
    pub all: Vec<ExpirationInfo>,
}

// Symbol search types
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SymbolInfo {
    pub symbol: String,      // e.g., "NIFTY", "BANKNIFTY"
    pub full_name: String,   // e.g., "NIFTY 50", "BANK NIFTY"
    pub underlying: String,  // e.g., "NSE:NIFTY", "NSE:BANKNIFTY"
    pub exchange: String,    // e.g., "NSE", "BSE"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SymbolSearchResult {
    pub symbol: String,
    pub underlying: String,
    pub exchange: String,
    pub has_options: bool,
    pub expiration_count: usize,
    pub expirations: Vec<ExpirationInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SymbolSearchResponse {
    pub results: Vec<SymbolSearchResult>,
    pub query: String,
}

// OHLC data
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OHLCBar {
    pub timestamp: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: Option<f64>,
}

// Camarilla Pivot Points
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CamarillaPivots {
    pub r4: f64,
    pub r3: f64,
    pub r2: f64,
    pub r1: f64,
    pub s1: f64,
    pub s2: f64,
    pub s3: f64,
    pub s4: f64,
    pub pivot: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OHLCResponse {
    pub symbol: String,
    pub bars_count: usize,
    pub ohlc_data: Vec<OHLCBar>,
    pub daily_data: Vec<OHLCBar>,  // Daily bars for per-day pivot calculation
}

