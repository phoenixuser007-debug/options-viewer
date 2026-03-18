import { invoke } from '@tauri-apps/api/core';
import type {
    OptionsResponse,
    PriceResponse,
    ExpirationsResponse,
    OHLCResponse,
    SymbolSearchResponse
} from '../types';

export async function fetchOptions(symbol: string, expiration: number): Promise<OptionsResponse> {
    return invoke<OptionsResponse>('fetch_options', { symbol, expiration });
}

export async function fetchPrice(symbol: string): Promise<PriceResponse> {
    return invoke<PriceResponse>('fetch_price', { symbol });
}

export async function fetchExpirations(symbol: string): Promise<ExpirationsResponse> {
    return invoke<ExpirationsResponse>('fetch_expirations', { symbol });
}

export async function fetchOptionOhlc(symbol: string, bars: number = 30, timeframe: string = '15'): Promise<OHLCResponse> {
    return invoke<OHLCResponse>('fetch_option_ohlc', { symbol, bars, timeframe });
}

export async function searchSymbol(query: string): Promise<SymbolSearchResponse> {
    return invoke<SymbolSearchResponse>('search_symbol', { query });
}

export async function startPriceStream(symbols: string[]): Promise<void> {
    return invoke<void>('start_price_stream', { symbols });
}

export async function stopPriceStream(): Promise<void> {
    return invoke<void>('stop_price_stream');
}
