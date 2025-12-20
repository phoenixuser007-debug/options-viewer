import { useState, useEffect, useRef, useCallback } from 'react';
import { searchSymbol } from '../hooks/useTauriCommands';
import type { SymbolSearchResult } from '../types';

interface SymbolSearchProps {
  selectedSymbol: string;
  onSymbolSelect: (result: SymbolSearchResult) => void;
}

// Default symbols to show in dropdown
const DEFAULT_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];

export function SymbolSearch({ selectedSymbol, onSymbolSelect }: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentSymbols, setRecentSymbols] = useState<SymbolSearchResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isInputMode, setIsInputMode] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recent symbols from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('recentSymbols');
    if (stored) {
      try {
        setRecentSymbols(JSON.parse(stored));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Save recent symbols to localStorage
  const addToRecent = useCallback((result: SymbolSearchResult) => {
    setRecentSymbols(prev => {
      const filtered = prev.filter(r => r.symbol !== result.symbol);
      const updated = [result, ...filtered].slice(0, 5);
      localStorage.setItem('recentSymbols', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Debounced search function
  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const response = await searchSymbol(searchQuery);
      setResults(response.results);
      setHighlightedIndex(-1);

      if (response.results.length === 0) {
        setError(`No options found for "${searchQuery}"`);
      }
    } catch (err) {
      console.error('Search error:', err);
      setError(`Search failed: ${err}`);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Handle input change with debounce
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
    setQuery(value);

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (value.length >= 2) {
      debounceTimer.current = setTimeout(() => {
        performSearch(value);
      }, 300);
    } else {
      setResults([]);
      setError(null);
    }
  }, [performSearch]);

  // Handle result selection
  const handleSelect = useCallback((result: SymbolSearchResult) => {
    setQuery('');
    setShowDropdown(false);
    setResults([]);
    setHighlightedIndex(-1);
    setIsInputMode(false);
    addToRecent(result);
    onSymbolSelect(result);
  }, [addToRecent, onSymbolSelect]);

  // Handle click on quick select buttons
  const handleQuickSelect = useCallback(async (symbol: string) => {
    setIsSearching(true);
    try {
      const response = await searchSymbol(symbol);
      if (response.results.length > 0) {
        handleSelect(response.results[0]);
      }
    } catch (err) {
      console.error('Quick select error:', err);
    } finally {
      setIsSearching(false);
    }
  }, [handleSelect]);

  // Handle button click to open dropdown
  const handleButtonClick = useCallback(() => {
    setShowDropdown(true);
    setIsInputMode(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const allItems = [
      ...results,
      ...(query.length < 2 ? DEFAULT_SYMBOLS.map(s => ({ symbol: s, exchange: 'NSE', expiration_count: 0 })) : []),
      ...(query.length < 2 ? recentSymbols : [])
    ];
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.min(prev + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      const item = allItems[highlightedIndex];
      if ('expiration_count' in item && item.expiration_count > 0) {
        handleSelect(item as SymbolSearchResult);
      } else {
        handleQuickSelect(item.symbol);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setIsInputMode(false);
      setQuery('');
    }
  }, [results, recentSymbols, highlightedIndex, handleSelect, handleQuickSelect, query.length]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setIsInputMode(false);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="relative">
      {/* Compact Symbol Button/Input */}
      {!isInputMode ? (
        <button
          onClick={handleButtonClick}
          className="
            flex items-center gap-2 px-3 py-1.5
            bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)]
            border border-[var(--border-color)]
            rounded-lg transition-colors
            text-[var(--text-primary)] font-semibold text-sm
          "
        >
          <span>{selectedSymbol}</span>
          <svg className="w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search symbol..."
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="
              w-40 px-3 py-1.5 text-sm
              bg-[var(--bg-tertiary)]
              border border-tv-blue
              rounded-lg
              text-[var(--text-primary)] placeholder:text-[var(--text-muted)]
              focus:outline-none focus:ring-1 focus:ring-tv-blue/30
            "
          />
          {isSearching && (
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              <div className="w-3.5 h-3.5 border-2 border-[var(--border-light)] border-t-tv-blue rounded-full animate-spin" />
            </div>
          )}
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div className="
          absolute top-full left-0 mt-1 w-56 max-h-72 overflow-auto
          bg-[var(--bg-secondary)] border border-[var(--border-color)]
          rounded-lg shadow-xl z-50
        ">
          {/* Quick Select - Always visible when not searching */}
          {query.length < 2 && (
            <div className="p-1 border-b border-[var(--border-color)]">
              <div className="px-2 py-1 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                Popular
              </div>
              {DEFAULT_SYMBOLS.map((sym, idx) => (
                <button
                  key={sym}
                  onClick={() => handleQuickSelect(sym)}
                  disabled={isSearching}
                  className={`
                    w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-sm
                    transition-colors
                    ${highlightedIndex === idx
                      ? 'bg-tv-blue/10 text-tv-blue'
                      : selectedSymbol === sym
                        ? 'bg-tv-blue/5 text-tv-blue'
                        : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'
                    }
                  `}
                >
                  <span className="font-medium">{sym}</span>
                  {selectedSymbol === sym && (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Search Results */}
          {results.length > 0 && (
            <div className="p-1">
              <div className="px-2 py-1 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                Results
              </div>
              {results.map((result, idx) => (
                <button
                  key={`${result.exchange}:${result.symbol}`}
                  onClick={() => handleSelect(result)}
                  className={`
                    w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-sm
                    transition-colors
                    ${highlightedIndex === idx
                      ? 'bg-tv-blue/10 text-tv-blue'
                      : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'
                    }
                  `}
                >
                  <span className="font-medium">{result.symbol}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {result.expiration_count} exp
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Error */}
          {error && query.length >= 2 && (
            <div className="px-3 py-2 text-xs text-tv-red">{error}</div>
          )}

          {/* Recent Symbols */}
          {query.length < 2 && recentSymbols.length > 0 && (
            <div className="p-1">
              <div className="px-2 py-1 text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                Recent
              </div>
              {recentSymbols.map((result, idx) => (
                <button
                  key={`recent-${result.exchange}:${result.symbol}`}
                  onClick={() => handleSelect(result)}
                  className={`
                    w-full flex items-center justify-between px-2 py-1.5 rounded text-left text-sm
                    transition-colors
                    ${highlightedIndex === idx + DEFAULT_SYMBOLS.length
                      ? 'bg-tv-blue/10 text-tv-blue'
                      : 'hover:bg-[var(--bg-hover)] text-[var(--text-primary)]'
                    }
                  `}
                >
                  <span className="font-medium">{result.symbol}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{result.exchange}</span>
                </button>
              ))}
            </div>
          )}

          {/* Loading */}
          {isSearching && (
            <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Searching...</div>
          )}
        </div>
      )}
    </div>
  );
}
