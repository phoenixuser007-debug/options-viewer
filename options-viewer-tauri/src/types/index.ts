// Symbol search types
export interface SymbolInfo {
    symbol: string;      // e.g., "NIFTY", "BANKNIFTY"
    full_name: string;   // e.g., "NIFTY 50", "BANK NIFTY"
    underlying: string;  // e.g., "NSE:NIFTY", "NSE:BANKNIFTY"
    exchange: string;    // e.g., "NSE", "BSE"
}

export interface SymbolSearchResult {
    symbol: string;
    underlying: string;
    exchange: string;
    has_options: boolean;
    expiration_count: number;
    expirations: ExpirationInfo[];
}

export interface SymbolSearchResponse {
    results: SymbolSearchResult[];
    query: string;
}

// Options API types
export interface OptionsResponse {
    symbols: OptionSymbol[] | null;
    fields: string[] | null;
}

export interface OptionSymbol {
    s: string;
    f: (string | number | null)[];
}

// Price types
export interface PriceResponse {
    price: number;
    change: number;
    change_abs: number;
    high: number;
    low: number;
    open: number;
    volume: number;
}

export interface PriceUpdate {
    symbol: string;
    price: number;
    bid?: number | null;
    ask?: number | null;
    change: number;
    change_abs: number;
    high: number;
    low: number;
    open: number;
    volume: number;
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
    rho?: number | null;
    iv?: number | null;
}

// Expiration types
export interface ExpirationInfo {
    value: number;
    formatted: string;
    day_of_week: string;
}

export interface ExpirationsMonth {
    month: number;
    month_name: string;
    year: number;
    count: number;
    expirations: ExpirationInfo[];
}

export interface ExpirationsResponse {
    current_month: ExpirationsMonth;
    next_month: ExpirationsMonth;
    all: ExpirationInfo[];
}

// OHLC types
export interface OHLCBar {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number | null;
}


export interface OHLCResponse {
    symbol: string;
    bars_count: number;
    ohlc_data: OHLCBar[];
    daily_data: OHLCBar[];  // Daily bars for per-day pivot calculation
}

// Processed option data for display
export interface OptionData {
    ask: number | null;
    bid: number | null;
    currency: string | null;
    delta: number | null;
    expiration: number | null;
    gamma: number | null;
    iv: number | null;
    'option-type': string | null;
    pricescale: number | null;
    rho: number | null;
    root: string | null;
    strike: number;
    theoPrice: number | null;
    theta: number | null;
    vega: number | null;
    bid_iv: number | null;
    ask_iv: number | null;
    volume: number | null;
}

export interface StrikeData {
    strike: number;
    call: OptionData | null;
    put: OptionData | null;
}
