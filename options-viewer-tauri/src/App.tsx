import { useState, useEffect, useCallback, useMemo } from 'react';
import { ExpirySelector } from './components/ExpirySelector';
import { PriceDisplay } from './components/PriceDisplay';
import { OptionsTable } from './components/OptionsTable';
import { OHLCModal } from './components/OHLCModal';
import { SymbolSearch } from './components/SymbolSearch';
import { fetchOptions, fetchPrice, fetchExpirations } from './hooks/useTauriCommands';
import type { ExpirationInfo, StrikeData, OptionData, OptionsResponse, SymbolSearchResult } from './types';
import './index.css';

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
    <div className="container">
      <header className="compact-header glass">
        <SymbolSearch
          selectedSymbol={selectedSymbol}
          onSymbolSelect={handleSymbolSelect}
        />
        <ExpirySelector
          expirations={expirations}
          selectedExpiration={selectedExpiration}
          onSelect={setSelectedExpiration}
        />
        <PriceDisplay price={spotPrice} symbol={selectedSymbol} />
      </header>

      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <p>Fetching {selectedSymbol} options data...</p>
        </div>
      )}

      {error && !loading && (
        <div className="error">
          <span className="error-icon">⚠</span>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && strikes.length > 0 && (
        <OptionsTable
          strikes={strikes}
          currentPrice={spotPrice || 0}
          onOptionClick={handleOptionClick}
        />
      )}



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
