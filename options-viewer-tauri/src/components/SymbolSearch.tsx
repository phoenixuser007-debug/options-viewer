import { useState, useEffect, useRef, useCallback } from 'react';
import { searchSymbol } from '../hooks/useTauriCommands';
import type { SymbolSearchResult } from '../types';

interface SymbolSearchProps {
    selectedSymbol: string;
    onSymbolSelect: (result: SymbolSearchResult) => void;
}

// Default symbols to show initially
const DEFAULT_SYMBOLS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];

export function SymbolSearch({ selectedSymbol, onSymbolSelect }: SymbolSearchProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SymbolSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [recentSymbols, setRecentSymbols] = useState<SymbolSearchResult[]>([]);
    
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
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
            const updated = [result, ...filtered].slice(0, 5); // Keep max 5
            localStorage.setItem('recentSymbols', JSON.stringify(updated));
            return updated;
        });
    }, []);

    // Debounced search function
    const performSearch = useCallback(async (searchQuery: string) => {
        if (searchQuery.length < 3) {
            setResults([]);
            setError(null);
            return;
        }

        setIsSearching(true);
        setError(null);

        try {
            const response = await searchSymbol(searchQuery);
            setResults(response.results);
            
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
        setShowDropdown(true);

        // Clear previous timer
        if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
        }

        // Only search if 3+ characters
        if (value.length >= 3) {
            debounceTimer.current = setTimeout(() => {
                performSearch(value);
            }, 300); // 300ms debounce
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

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                dropdownRef.current && 
                !dropdownRef.current.contains(e.target as Node) &&
                inputRef.current &&
                !inputRef.current.contains(e.target as Node)
            ) {
                setShowDropdown(false);
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
        <div className="symbol-search">
            <div className="search-input-wrapper">
                <input
                    ref={inputRef}
                    type="text"
                    className="search-input"
                    placeholder="Search symbol..."
                    value={query}
                    onChange={handleInputChange}
                    onFocus={() => setShowDropdown(true)}
                />
                {isSearching && <div className="search-spinner" />}
            </div>

            {/* Current symbol badge */}
            <div className="current-symbol">
                <span className="symbol-badge">{selectedSymbol}</span>
            </div>

            {/* Quick select buttons for common symbols */}
            <div className="quick-symbols">
                {DEFAULT_SYMBOLS.map(sym => (
                    <button
                        key={sym}
                        className={`quick-btn ${selectedSymbol === sym ? 'active' : ''}`}
                        onClick={() => handleQuickSelect(sym)}
                        disabled={isSearching}
                    >
                        {sym}
                    </button>
                ))}
            </div>

            {/* Dropdown results */}
            {showDropdown && (query.length >= 3 || recentSymbols.length > 0) && (
                <div ref={dropdownRef} className="search-dropdown">
                    {/* Search results */}
                    {results.length > 0 && (
                        <div className="dropdown-section">
                            <div className="dropdown-label">Search Results</div>
                            {results.map(result => (
                                <button
                                    key={`${result.exchange}:${result.symbol}`}
                                    className="dropdown-item"
                                    onClick={() => handleSelect(result)}
                                >
                                    <span className="item-symbol">{result.symbol}</span>
                                    <span className="item-exchange">{result.exchange}</span>
                                    <span className="item-expiries">{result.expiration_count} expiries</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Error message */}
                    {error && query.length >= 3 && (
                        <div className="dropdown-error">{error}</div>
                    )}

                    {/* Recent symbols */}
                    {query.length < 3 && recentSymbols.length > 0 && (
                        <div className="dropdown-section">
                            <div className="dropdown-label">Recent</div>
                            {recentSymbols.map(result => (
                                <button
                                    key={`recent-${result.exchange}:${result.symbol}`}
                                    className="dropdown-item"
                                    onClick={() => handleSelect(result)}
                                >
                                    <span className="item-symbol">{result.symbol}</span>
                                    <span className="item-exchange">{result.exchange}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Loading indicator */}
                    {isSearching && (
                        <div className="dropdown-loading">Searching...</div>
                    )}
                </div>
            )}
        </div>
    );
}
