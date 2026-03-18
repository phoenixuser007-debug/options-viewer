import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ExpirySelector } from './components/ExpirySelector';
import { OptionsTable } from './components/OptionsTable';
import { OHLCModal } from './components/OHLCModal';
import { SymbolSearch } from './components/SymbolSearch';
import { ThemeToggle } from './components/ThemeToggle';
import { fetchOptions, fetchPrice, fetchExpirations, startPriceStream, stopPriceStream } from './hooks/useTauriCommands';
import type { ExpirationInfo, StrikeData, OptionData, OptionsResponse, SymbolSearchResult, PriceUpdate } from './types';

const COLUMN_NAMES = ['ask', 'bid', 'currency', 'delta', 'expiration', 'gamma', 'iv', 'option-type', 'pricescale', 'rho', 'root', 'strike', 'theoPrice', 'theta', 'vega', 'bid_iv', 'ask_iv'];

function normalizeSymbolForMatch(value: string): string {
  return value.toUpperCase().split('|')[0].trim();
}

function parseOptionSymbol(symbol: string): { optionType: 'C' | 'P'; strike: number } | null {
  const normalized = normalizeSymbolForMatch(symbol);
  const noExchange = normalized.includes(':') ? normalized.split(':')[1] : normalized;
  const match = noExchange.match(/([CP])(\d+(?:\.\d+)?)$/);
  if (!match) return null;

  const optionType = match[1] as 'C' | 'P';
  const strike = Number(match[2]);
  if (!Number.isFinite(strike)) return null;

  return { optionType, strike };
}


function App() {
  // Symbol state
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NIFTY');

  const [expirations, setExpirations] = useState<ExpirationInfo[]>([]);
  const [selectedExpiration, setSelectedExpiration] = useState<number | null>(null);
  const [strikes, setStrikes] = useState<StrikeData[]>([]);
  const [spotPrice, setSpotPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [strikesReady, setStrikesReady] = useState(false);
  const strikesRef = useRef<StrikeData[]>([]);
  const tvSymbolsRef = useRef<string[]>([]);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStrike, setModalStrike] = useState<number>(0);
  const [modalOptionType, setModalOptionType] = useState<'C' | 'P'>('C');

  useEffect(() => {
    strikesRef.current = strikes;
  }, [strikes]);

  // Build symbol for OHLC modal
  const modalSymbol = useMemo(() => {
    if (!selectedExpiration) return '';
    const expStr = selectedExpiration.toString();
    const formattedExp = expStr.length === 8 ? expStr.substring(2) : expStr;
    return `NSE:${selectedSymbol}${formattedExp}${modalOptionType}${modalStrike}`;
  }, [selectedExpiration, modalOptionType, modalStrike, selectedSymbol]);

  // Handle symbol selection from search
  const handleSymbolSelect = useCallback((result: SymbolSearchResult) => {
    setSelectedSymbol(result.symbol);
    // Reset state for new symbol
    setExpirations([]);
    setSelectedExpiration(null);
    setStrikes([]);
    setStrikesReady(false);
    tvSymbolsRef.current = [];
    setSpotPrice(null);
    setError(null);
  }, []);

  // Load expirations when symbol changes
  useEffect(() => {
    const loadExpirations = async () => {
      setLoading(true);
      try {
        const data = await fetchExpirations(selectedSymbol);
        const next5 = data.all.slice(0, 5);
        setExpirations(next5);

        if (next5.length > 0) {
          setSelectedExpiration(next5[0].value);
        } else {
          setError(`No expirations found for ${selectedSymbol}`);
          setLoading(false);
        }
      } catch (err) {
        console.error('Error loading expirations:', err);
        setError(`Failed to load expirations: ${err}`);
        setLoading(false);
      }
    };

    loadExpirations();
  }, [selectedSymbol]);

  // Load options and price when expiration changes
  useEffect(() => {
    if (!selectedExpiration) return;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      setStrikesReady(false);
      tvSymbolsRef.current = [];

      try {
        const [optionsData, priceData] = await Promise.all([
          fetchOptions(selectedSymbol, selectedExpiration),
          fetchPrice(selectedSymbol).catch(() => null),
        ]);

        if (priceData) {
          setSpotPrice(priceData.price);
        }

        processOptionsData(optionsData, priceData?.price || null);
      } catch (err) {
        console.error('Error loading options:', err);
        setError(`Failed to load options: ${err}`);
      } finally {
        setLoading(false);
      }
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExpiration, selectedSymbol]);

  // Price streaming
  useEffect(() => {
    let unlistenPrice: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    let disposed = false;

    const setup = async () => {
      try {
        unlistenPrice = await listen<PriceUpdate>('price-update', (event) => {
          const update = event.payload;
          const ticker = normalizeSymbolForMatch(selectedSymbol.includes(':')
            ? selectedSymbol.toUpperCase()
            : `NSE:${selectedSymbol.toUpperCase()}`);

          const updateSymbol = normalizeSymbolForMatch(update.symbol);

          if (updateSymbol === ticker || updateSymbol.startsWith(`${ticker}:`) || updateSymbol.startsWith(`${ticker}|`)) {
            setSpotPrice(update.price);
            return;
          }

          const parsedOption = parseOptionSymbol(updateSymbol);
          if (!parsedOption) return;

          // Use lp as bid fallback when bid/ask aren't in the update (NSE often only sends lp)
          const ltp = update.price > 0 ? update.price : null;
          const nextBid = update.bid ?? ltp;
          const nextAsk = update.ask ?? null;
          if (nextBid === null && nextAsk === null) return;

          setStrikes((prev) => {
            let changed = false;
            const updated = prev.map((row) => {
              if (row.strike !== parsedOption.strike) return row;

              if (parsedOption.optionType === 'C' && row.call) {
                const call = {
                  ...row.call,
                  bid: nextBid ?? row.call.bid,
                  ask: nextAsk ?? row.call.ask,
                };
                changed = true;
                return { ...row, call };
              }

              if (parsedOption.optionType === 'P' && row.put) {
                const put = {
                  ...row.put,
                  bid: nextBid ?? row.put.bid,
                  ask: nextAsk ?? row.put.ask,
                };
                changed = true;
                return { ...row, put };
              }

              return row;
            });

            return changed ? updated : prev;
          });
        });

        unlistenError = await listen<string>('price-error', (event) => {
          console.error('Price stream error:', event.payload);
        });

        if (!disposed) {
          const base = selectedSymbol.includes(':') ? selectedSymbol.toUpperCase() : `NSE:${selectedSymbol.toUpperCase()}`;
          const streamSymbols = [base, ...tvSymbolsRef.current];
          await startPriceStream(streamSymbols);
        }
      } catch (err) {
        console.error('Error starting price stream:', err);
      }
    };

    if (strikesReady && selectedExpiration) {
      setup();
    }

    return () => {
      disposed = true;
      if (unlistenPrice) {
        unlistenPrice();
      }
      if (unlistenError) {
        unlistenError();
      }
      stopPriceStream().catch((err) => {
        console.error('Error stopping price stream:', err);
      });
    };
  }, [selectedSymbol, selectedExpiration, strikesReady]);

  const processOptionsData = useCallback((data: OptionsResponse, price: number | null) => {
    if (!data.symbols || data.symbols.length === 0) {
      setError('No options data available');
      return;
    }

    // Build strike map + symbol lookup (strike_C/strike_P → actual TV symbol)
    const strikeMap = new Map<number, StrikeData>();
    const tvSymbolMap = new Map<string, string>();

    data.symbols.forEach((option) => {
      const values = option.f;
      const columnNames = data.fields || COLUMN_NAMES;

      // Create option data object
      const optionData: OptionData = {} as OptionData;
      columnNames.forEach((col, idx) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (optionData as any)[col] = values[idx];
      });

      const strike = optionData.strike;
      const optionType = optionData['option-type'];

      if (!strikeMap.has(strike)) {
        strikeMap.set(strike, { strike, call: null, put: null });
      }

      if (optionType === 'call') {
        strikeMap.get(strike)!.call = optionData;
        tvSymbolMap.set(`${strike}_C`, option.s);
      } else if (optionType === 'put') {
        strikeMap.get(strike)!.put = optionData;
        tvSymbolMap.set(`${strike}_P`, option.s);
      }
    });

    // Sort strikes
    const allStrikes = Array.from(strikeMap.values()).sort((a, b) => a.strike - b.strike);

    // Estimate price from options if not available
    let currentPrice = price;
    if (!currentPrice) {
      currentPrice = estimatePrice(allStrikes);
      setSpotPrice(currentPrice);
    }

    // Filter 10 strikes around current price
    const filteredStrikes = filterStrikesAroundPrice(allStrikes, currentPrice, 10);

    // Only stream TV symbols for the visible strikes (~20 symbols max)
    const filteredTvSymbols: string[] = [];
    for (const row of filteredStrikes) {
      const c = tvSymbolMap.get(`${row.strike}_C`);
      const p = tvSymbolMap.get(`${row.strike}_P`);
      if (c) filteredTvSymbols.push(c);
      if (p) filteredTvSymbols.push(p);
    }
    tvSymbolsRef.current = filteredTvSymbols;

    setStrikes(filteredStrikes);
    setStrikesReady(true);
  }, []);

  const estimatePrice = (strikes: StrikeData[]): number => {
    if (strikes.length === 0) return 0;

    let minDiff = Infinity;
    let atmStrike = strikes[Math.floor(strikes.length / 2)].strike;

    strikes.forEach((strikeData) => {
      if (strikeData.call && strikeData.put) {
        const callIV = strikeData.call.iv || 0;
        const putIV = strikeData.put.iv || 0;
        const diff = Math.abs(callIV - putIV);

        if (diff < minDiff) {
          minDiff = diff;
          atmStrike = strikeData.strike;
        }
      }
    });

    return atmStrike;
  };

  const filterStrikesAroundPrice = (strikes: StrikeData[], price: number, count: number): StrikeData[] => {
    let closestIndex = 0;
    let minDiff = Infinity;

    strikes.forEach((strikeData, idx) => {
      const diff = Math.abs(strikeData.strike - price);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = idx;
      }
    });

    const halfCount = Math.floor(count / 2);
    const startIdx = Math.max(0, closestIndex - halfCount);
    const endIdx = Math.min(strikes.length, startIdx + count);

    return strikes.slice(startIdx, endIdx);
  };

  const handleOptionClick = useCallback((strike: number, optionType: 'C' | 'P') => {
    setModalStrike(strike);
    setModalOptionType(optionType);
    setModalOpen(true);
  }, []);

  return (
    <div className="fixed inset-0 grid grid-rows-[auto_1fr] overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] transition-theme">
      {/* Header - Compact single row */}
      <header className="bg-[var(--bg-secondary)] border-b border-[var(--border-color)] transition-theme">
        <div className="px-3 py-2 flex items-center gap-3">
          {/* Symbol Dropdown */}
          <SymbolSearch
            selectedSymbol={selectedSymbol}
            onSymbolSelect={handleSymbolSelect}
          />
          
          {/* Expiry Pills */}
          <ExpirySelector
            expirations={expirations}
            selectedExpiration={selectedExpiration}
            onSelect={setSelectedExpiration}
          />
          
          {/* Spacer */}
          <div className="flex-1" />
          
          {/* Price Display */}
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-tv-green font-bold tabular-nums">
              {spotPrice ? `₹${spotPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
            </span>
          </div>
          
          {/* Theme Toggle */}
          <ThemeToggle />
        </div>
      </header>

      {/* Main Content - Takes remaining height via grid */}
      <main className="relative min-h-0">
        {/* Loading State */}
        {loading && (
          <div className="absolute inset-2 flex flex-col items-center justify-center gap-4">
            <div className="w-10 h-10 border-3 border-[var(--border-light)] border-t-tv-blue rounded-full animate-spin" />
            <p className="text-[var(--text-secondary)] text-sm">
              Fetching {selectedSymbol} options data...
            </p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="absolute inset-2 flex items-center justify-center">
            <div className="flex items-center gap-3 px-6 py-4 rounded-lg bg-tv-red/10 border border-tv-red/20 text-tv-red">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm font-medium">{error}</p>
            </div>
          </div>
        )}

        {/* Options Table - Full height */}
        {!loading && !error && strikes.length > 0 && (
          <div className="absolute inset-2">
            <OptionsTable
              strikes={strikes}
              currentPrice={spotPrice || 0}
              onOptionClick={handleOptionClick}
            />
          </div>
        )}
      </main>

      {/* OHLC Modal */}
      <OHLCModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        symbol={modalSymbol}
        strike={modalStrike}
        optionType={modalOptionType}
        expiration={selectedExpiration || 0}
      />
    </div>
  );
}

export default App;
