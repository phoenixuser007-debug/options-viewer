import { useEffect, useRef, useState, useCallback } from 'react';
import { Chart, registerables } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';
import 'chartjs-adapter-date-fns';
import { CandlestickController, CandlestickElement, OhlcElement } from 'chartjs-chart-financial';
import type { OHLCBar } from '../types';
import { fetchOptionOhlc } from '../hooks/useTauriCommands';

// Register Chart.js components including annotation and zoom plugins
Chart.register(...registerables, CandlestickController, CandlestickElement, OhlcElement, annotationPlugin, zoomPlugin);

interface OHLCModalProps {
    isOpen: boolean;
    onClose: () => void;
    symbol: string;
    strike: number;
    optionType: 'C' | 'P';
    expiration: number;
}

// NSE market hours in IST: 9:15 AM - 3:30 PM
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 15;
const MARKET_CLOSE_HOUR = 15;
const MARKET_CLOSE_MINUTE = 30;

// Check if a bar is within market hours
function isMarketHours(timestamp: number): boolean {
    const date = new Date(timestamp * 1000);
    const hour = date.getHours();
    const minute = date.getMinutes();
    const timeInMinutes = hour * 60 + minute;
    const marketOpenMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
    const marketCloseMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;
    return timeInMinutes >= marketOpenMinutes && timeInMinutes <= marketCloseMinutes;
}

// Calculate Camarilla pivots (only r4, pivot, s4)
interface SimplePivots {
    r4: number;
    pivot: number;
    s4: number;
}

function calculateCamarillaPivots(high: number, low: number, close: number): SimplePivots {
    const range = high - low;
    return {
        r4: close + range * 1.1 / 2,
        pivot: (high + low + close) / 3,
        s4: close - range * 1.1 / 2,
    };
}

// Get date string for comparison (YYYY-MM-DD)
function getDateString(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toISOString().split('T')[0];
}

// Format time for display
function formatBarTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const day = date.getDate().toString().padStart(2, '0');
    const month = date.toLocaleString('en', { month: 'short' });
    const hours = date.getHours().toString().padStart(2, '0');
    const mins = date.getMinutes().toString().padStart(2, '0');
    return `${day} ${month} ${hours}:${mins}`;
}

function formatExpiration(expNum: number): string {
    const expStr = expNum.toString();
    const year = expStr.substring(0, 4);
    const month = expStr.substring(4, 6);
    const day = expStr.substring(6, 8);
    return `${day}/${month}/${year}`;
}

interface DayPivot {
    date: string;
    pivots: SimplePivots;
    startIndex: number;
    endIndex: number;
}

// Create annotations for a single day's pivots using line annotations
function createDayPivotAnnotations(dayPivot: DayPivot, dayIndex: number): Record<string, unknown> {
    const { pivots, startIndex, endIndex } = dayPivot;
    const prefix = `d${dayIndex}`;

    return {
        [`${prefix}_r4`]: {
            type: 'line' as const,
            xMin: startIndex,
            xMax: endIndex,
            yMin: pivots.r4,
            yMax: pivots.r4,
            borderColor: '#ef4444',
            borderWidth: 1,
            borderDash: [4, 2],
        },
        [`${prefix}_pivot`]: {
            type: 'line' as const,
            xMin: startIndex,
            xMax: endIndex,
            yMin: pivots.pivot,
            yMax: pivots.pivot,
            borderColor: '#6366f1',
            borderWidth: 1,
            borderDash: [4, 2],
        },
        [`${prefix}_s4`]: {
            type: 'line' as const,
            xMin: startIndex,
            xMax: endIndex,
            yMin: pivots.s4,
            yMax: pivots.s4,
            borderColor: '#10b981',
            borderWidth: 1,
            borderDash: [4, 2],
        },
    };
}

type Timeframe = '5' | '15';

interface CachedData {
    ohlcData: OHLCBar[];
    pivotData: DayPivot[];
}

export function OHLCModal({ isOpen, onClose, symbol, strike, optionType, expiration }: OHLCModalProps) {
    const chartRef = useRef<HTMLCanvasElement>(null);
    const chartInstanceRef = useRef<Chart | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [timeframe, setTimeframe] = useState<Timeframe>('15');
    const [currentType, setCurrentType] = useState<'C' | 'P'>(optionType);

    // Cache for both CE and PE data
    const cacheRef = useRef<{
        C: CachedData | null;
        P: CachedData | null;
        timeframe: Timeframe | null;
    }>({ C: null, P: null, timeframe: null });

    // Get symbol for a specific option type
    // Symbol format: NSE:NIFTY241212C24500 where C/P is the option type
    const getSymbolForType = useCallback((optType: 'C' | 'P') => {
        if (optType === optionType) return symbol;
        // Replace the option type character (C or P) followed by the strike number
        // The pattern matches: option type (C or P) followed by digits at the end
        const currentTypeChar = optionType; // 'C' or 'P'
        const newTypeChar = optType; // 'C' or 'P'
        return symbol.replace(new RegExp(`${currentTypeChar}(\\d+)$`), `${newTypeChar}$1`);
    }, [symbol, optionType]);

    // Process raw data into chart-ready format
    const processData = useCallback((data: { ohlc_data: OHLCBar[]; daily_data?: OHLCBar[] }): CachedData | null => {
        if (!data.ohlc_data || data.ohlc_data.length === 0) {
            return null;
        }

        const filteredData = data.ohlc_data.filter(bar => isMarketHours(bar.timestamp));
        filteredData.sort((a, b) => a.timestamp - b.timestamp);

        if (filteredData.length === 0) {
            return null;
        }

        const dailyMap = new Map<string, OHLCBar>();
        if (data.daily_data) {
            data.daily_data.forEach(bar => {
                const dateStr = getDateString(bar.timestamp);
                dailyMap.set(dateStr, bar);
            });
        }

        const dayIndexRanges = new Map<string, { start: number; end: number }>();
        filteredData.forEach((bar, index) => {
            const dateStr = getDateString(bar.timestamp);
            if (!dayIndexRanges.has(dateStr)) {
                dayIndexRanges.set(dateStr, { start: index, end: index });
            } else {
                dayIndexRanges.get(dateStr)!.end = index;
            }
        });

        const uniqueDays = Array.from(dayIndexRanges.keys()).sort();
        const calculatedDayPivots: DayPivot[] = [];
        const sortedDailyDates = Array.from(dailyMap.keys()).sort();

        for (const currentDay of uniqueDays) {
            const prevDayIndex = sortedDailyDates.findIndex(d => d >= currentDay) - 1;
            if (prevDayIndex >= 0) {
                const prevDayBar = dailyMap.get(sortedDailyDates[prevDayIndex]);
                if (prevDayBar) {
                    const pivots = calculateCamarillaPivots(prevDayBar.high, prevDayBar.low, prevDayBar.close);
                    const range = dayIndexRanges.get(currentDay)!;
                    calculatedDayPivots.push({
                        date: currentDay,
                        pivots,
                        startIndex: range.start,
                        endIndex: range.end,
                    });
                }
            }
        }

        return { ohlcData: filteredData, pivotData: calculatedDayPivots };
    }, []);

    // Render chart from cached data
    const renderFromCache = useCallback((optType: 'C' | 'P', tf: Timeframe) => {
        const cached = cacheRef.current[optType];
        if (!cached || !chartRef.current) return;

        if (chartInstanceRef.current) {
            chartInstanceRef.current.destroy();
        }

        const displaySymbol = getSymbolForType(optType);
        const labels = cached.ohlcData.map(bar => formatBarTime(bar.timestamp));
        const chartData = cached.ohlcData.map((bar, index) => ({
            x: index,
            o: bar.open,
            h: bar.high,
            l: bar.low,
            c: bar.close,
        }));

        const ctx = chartRef.current.getContext('2d');
        if (!ctx) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let annotations: any = {};
        cached.pivotData.forEach((dp, idx) => {
            annotations = { ...annotations, ...createDayPivotAnnotations(dp, idx) };
        });

        chartInstanceRef.current = new Chart(ctx, {
            type: 'candlestick',
            data: {
                labels,
                datasets: [{
                    label: `${displaySymbol} (${tf}m)`,
                    data: chartData,
                    borderColor: {
                        up: '#10b981',
                        down: '#ef4444',
                        unchanged: '#6366f1',
                    } as any,
                    backgroundColor: {
                        up: 'rgba(16, 185, 129, 0.3)',
                        down: 'rgba(239, 68, 68, 0.3)',
                        unchanged: 'rgba(99, 102, 241, 0.3)',
                    } as any,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(30, 41, 59, 0.95)',
                        titleColor: '#f1f5f9',
                        bodyColor: '#cbd5e1',
                        borderColor: '#334155',
                        borderWidth: 1,
                        callbacks: {
                            title: (items) => items.length > 0 ? labels[items[0].dataIndex] : '',
                        },
                    },
                    annotation: { annotations },
                    zoom: {
                        pan: { enabled: true, mode: 'x' },
                        zoom: {
                            wheel: {
                                enabled: true,
                                speed: 0.1,
                            },
                            drag: {
                                enabled: true,
                                backgroundColor: 'rgba(99, 102, 241, 0.3)',
                                borderColor: 'rgba(99, 102, 241, 1)',
                                borderWidth: 2,
                                threshold: 10,
                            },
                            mode: 'x',
                            onZoomComplete: ({ chart }) => {
                                requestAnimationFrame(() => {
                                    const xScale = chart.scales.x;
                                    const minIdx = Math.max(0, Math.floor(xScale.min));
                                    const maxIdx = Math.min(chartData.length - 1, Math.ceil(xScale.max));
                                    let minY = Infinity, maxY = -Infinity;
                                    const step = maxIdx - minIdx > 100 ? Math.floor((maxIdx - minIdx) / 100) : 1;
                                    for (let i = minIdx; i <= maxIdx; i += step) {
                                        const bar = chartData[i];
                                        if (bar) {
                                            minY = Math.min(minY, bar.l);
                                            maxY = Math.max(maxY, bar.h);
                                        }
                                    }
                                    if (minY !== Infinity && maxY !== -Infinity) {
                                        const padding = (maxY - minY) * 0.05;
                                        chart.scales.y.options.min = minY - padding;
                                        chart.scales.y.options.max = maxY + padding;
                                        chart.update('none');
                                    }
                                });
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        min: 0,
                        max: cached.ohlcData.length - 1,
                        ticks: {
                            color: '#94a3b8',
                            maxRotation: 45,
                            autoSkip: true,
                            maxTicksLimit: 12,
                            callback: function (value) {
                                const idx = Math.round(value as number);
                                return idx >= 0 && idx < labels.length ? labels[idx] : '';
                            },
                        },
                        grid: { color: 'rgba(51, 65, 85, 0.3)' },
                    },
                    y: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: 'rgba(51, 65, 85, 0.3)' },
                    },
                },
            },
        });
    }, [getSymbolForType]);

    // Load both CE and PE data
    const loadAllData = useCallback(async (tf: Timeframe, initialType: 'C' | 'P') => {
        if (!symbol) return;

        setLoading(true);
        setError(null);
        cacheRef.current = { C: null, P: null, timeframe: null };

        try {
            // Calculate bar count based on timeframe (2+ weeks of data)
            const barCount = tf === '5' ? 1000 : 400;
            const ceSymbol = getSymbolForType('C');
            const peSymbol = getSymbolForType('P');

            console.log('Fetching OHLC data:', { ceSymbol, peSymbol, barCount, tf });

            // Fetch both in parallel
            const [ceData, peData] = await Promise.all([
                fetchOptionOhlc(ceSymbol, barCount, tf).catch(err => {
                    console.error('Error fetching CE data:', err);
                    return { ohlc_data: [], daily_data: [] };
                }),
                fetchOptionOhlc(peSymbol, barCount, tf).catch(err => {
                    console.error('Error fetching PE data:', err);
                    return { ohlc_data: [], daily_data: [] };
                })
            ]);

            console.log('CE data bars:', ceData.ohlc_data?.length || 0);
            console.log('PE data bars:', peData.ohlc_data?.length || 0);

            // Process and cache both
            cacheRef.current.C = processData(ceData);
            cacheRef.current.P = processData(peData);
            cacheRef.current.timeframe = tf;

            console.log('Cached C:', cacheRef.current.C ? 'yes' : 'no');
            console.log('Cached P:', cacheRef.current.P ? 'yes' : 'no');

            // Render initial type
            if (cacheRef.current[initialType]) {
                renderFromCache(initialType, tf);
            } else {
                setError('No historical data available');
            }
        } catch (err) {
            console.error('Error fetching OHLC:', err);
            setError(`Failed to load data: ${err}`);
        } finally {
            setLoading(false);
        }
    }, [symbol, getSymbolForType, processData, renderFromCache]);

    // Reset type when modal opens with new option
    useEffect(() => {
        if (isOpen) {
            setCurrentType(optionType);
        }
    }, [optionType, isOpen]);

    // Load data when modal opens or timeframe changes
    useEffect(() => {
        if (!isOpen || !symbol) return;
        loadAllData(timeframe, currentType);

        return () => {
            if (chartInstanceRef.current) {
                chartInstanceRef.current.destroy();
                chartInstanceRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, symbol, timeframe]);

    // Render chart when currentType changes (after state update completes)
    useEffect(() => {
        if (!isOpen || loading) return;

        // Render from cache if available
        if (cacheRef.current[currentType] && cacheRef.current.timeframe === timeframe) {
            console.log('useEffect: Rendering from cache for type:', currentType);
            setError(null);
            // Use setTimeout to ensure canvas is visible after error state clears
            setTimeout(() => {
                renderFromCache(currentType, timeframe);
            }, 0);
        } else if (cacheRef.current.timeframe !== null) {
            // Only show error if we've already loaded data (timeframe is set)
            console.log('useEffect: No cached data for type:', currentType);
            setError(`No data available for ${currentType === 'C' ? 'Call' : 'Put'} option`);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentType]);

    // Switch between cached data instantly when type changes
    const handleTypeToggle = (newType: 'C' | 'P') => {
        if (newType !== currentType) {
            console.log('Toggling to type:', newType);
            setCurrentType(newType);
        }
    };

    const handleTimeframeChange = (newTf: Timeframe) => {
        if (newTf !== timeframe) {
            setTimeframe(newTf);
        }
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="modal">
            <div className="modal-overlay" onClick={onClose} />
            <div className="modal-content">
                <button className="modal-close" onClick={onClose}>×</button>
                <div className="modal-body">
                    <h2 className="modal-title">
                        {strike} <span className={`title-type ${currentType === 'C' ? 'call' : 'put'}`}>{currentType === 'C' ? 'CE' : 'PE'}</span> <span className="title-separator">|</span> <span className="title-expiry">{formatExpiration(expiration)}</span>
                    </h2>

                    {/* Controls Row */}
                    <div className="timeframe-toggle">
                        {/* Call/Put Toggle */}
                        <span className="toggle-label">Type:</span>
                        <button
                            className={`tf-btn type-call ${currentType === 'C' ? 'active' : ''}`}
                            onClick={() => handleTypeToggle('C')}
                            disabled={loading}
                        >
                            CE
                        </button>
                        <button
                            className={`tf-btn type-put ${currentType === 'P' ? 'active' : ''}`}
                            onClick={() => handleTypeToggle('P')}
                            disabled={loading}
                        >
                            PE
                        </button>

                        <span className="toggle-divider">|</span>

                        {/* Timeframe Toggle */}
                        <span className="toggle-label">Timeframe:</span>
                        <button
                            className={`tf-btn ${timeframe === '5' ? 'active' : ''}`}
                            onClick={() => handleTimeframeChange('5')}
                            disabled={loading}
                        >
                            5m
                        </button>
                        <button
                            className={`tf-btn ${timeframe === '15' ? 'active' : ''}`}
                            onClick={() => handleTimeframeChange('15')}
                            disabled={loading}
                        >
                            15m
                        </button>
                        <span className="toggle-divider">|</span>
                        <button
                            className="tf-btn reset-btn"
                            onClick={() => {
                                if (chartInstanceRef.current) {
                                    const chart = chartInstanceRef.current;
                                    chart.scales.y.options.min = undefined;
                                    chart.scales.y.options.max = undefined;
                                    chart.resetZoom();
                                }
                            }}
                            disabled={loading}
                        >
                            Reset Zoom
                        </button>
                    </div>

                    <div className="chart-container glass">
                        {loading && (
                            <div className="modal-loading">
                                <div className="spinner"></div>
                                <p>Loading market data...</p>
                            </div>
                        )}
                        {error && (
                            <div className="modal-error">
                                <span className="error-icon">⚠️</span>
                                <p>{error}</p>
                            </div>
                        )}
                        <canvas
                            ref={chartRef}
                            style={{
                                display: 'block',
                                visibility: loading || error ? 'hidden' : 'visible',
                                borderRadius: '12px'
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
