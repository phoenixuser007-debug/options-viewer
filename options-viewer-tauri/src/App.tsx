import { useState, useEffect, useCallback, useMemo } from 'react';
import { ExpirySelector } from './components/ExpirySelector';
import { OptionsTable } from './components/OptionsTable';
import { OHLCModal } from './components/OHLCModal';
import { SymbolSearch } from './components/SymbolSearch';
import { ThemeToggle } from './components/ThemeToggle';
import { fetchOptions, fetchPrice, fetchExpirations } from './hooks/useTauriCommands';
import type { ExpirationInfo, StrikeData, OptionData, OptionsResponse, SymbolSearchResult } from './types';

const COLUMN_NAMES = ['ask', 'bid', 'currency', 'delta', 'expiration', 'gamma', 'iv', 'option-type', 'pricescale', 'rho', 'root', 'strike', 'theoPrice', 'theta', 'vega', 'bid_iv', 'ask_iv'];

function App() {
  // Symbol state
  const [selectedSymbol, setSelectedSymbol] = useState<string>('NIFTY');

  const [expirations, setExpirations] = useState<ExpirationInfo[]>([]);
  const [selectedExpiration, setSelectedExpiration] = useState<number | null>(null);
  const [strikes, setStrikes] = useState<StrikeData[]>([]);
  const [spotPrice, setSpotPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStrike, setModalStrike] = useState<number>(0);
  const [modalOptionType, setModalOptionType] = useState<'C' | 'P'>('C');

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

  const processOptionsData = useCallback((data: OptionsResponse, price: number | null) => {
    if (!data.symbols || data.symbols.length === 0) {
      setError('No options data available');
      return;
    }

    // Build strike map
    const strikeMap = new Map<number, StrikeData>();

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
      } else if (optionType === 'put') {
        strikeMap.get(strike)!.put = optionData;
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
    setStrikes(filteredStrikes);
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
