import { useEffect, useRef, useState, useCallback } from 'react';
import { Chart, registerables } from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';
import 'chartjs-adapter-date-fns';
import { CandlestickController, CandlestickElement, OhlcElement } from 'chartjs-chart-financial';
import type { OHLCBar } from '../types';
import { fetchOptionOhlc } from '../hooks/useTauriCommands';
import { useTheme } from '../context/ThemeContext';
import { calculatePriceChange } from '../utils/chartUtils';

// Register Chart.js components including annotation and zoom plugins
Chart.register(...registerables, CandlestickController, CandlestickElement, OhlcElement, annotationPlugin, zoomPlugin);

// Custom crosshair plugin
const crosshairPlugin = {
  id: 'crosshair',
  afterDraw: (chart: Chart) => {
    // @ts-expect-error - custom property
    const crosshair = chart.crosshair;
    if (!crosshair) return;

    const { ctx, chartArea, scales } = chart;
    const { x, y } = crosshair;

    if (x < chartArea.left || x > chartArea.right || y < chartArea.top || y > chartArea.bottom) {
      return;
    }

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(120, 123, 134, 0.5)';
    ctx.lineWidth = 1;

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();

    // Y value label on y-axis
    const yValue = scales.y.getValueForPixel(y);
    if (yValue !== undefined) {
      const labelText = yValue.toFixed(2);
      ctx.setLineDash([]);
      ctx.fillStyle = '#2962ff';
      ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif';
      const textWidth = ctx.measureText(labelText).width;
      const padding = 4;
      const labelX = chartArea.right + 2;
      const labelY = y;
      
      // Background
      ctx.fillRect(labelX, labelY - 8, textWidth + padding * 2, 16);
      
      // Text
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, labelX + padding, labelY);
    }

    ctx.restore();
  },
};

Chart.register(crosshairPlugin);

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

function isMarketHours(timestamp: number): boolean {
  const date = new Date(timestamp * 1000);
  const hour = date.getHours();
  const minute = date.getMinutes();
  const timeInMinutes = hour * 60 + minute;
  const marketOpenMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const marketCloseMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;
  return timeInMinutes >= marketOpenMinutes && timeInMinutes <= marketCloseMinutes;
}

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

function getDateString(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toISOString().split('T')[0];
}

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
      borderColor: '#f23645',
      borderWidth: 1,
      borderDash: [4, 2],
    },
    [`${prefix}_pivot`]: {
      type: 'line' as const,
      xMin: startIndex,
      xMax: endIndex,
      yMin: pivots.pivot,
      yMax: pivots.pivot,
      borderColor: '#2962ff',
      borderWidth: 1,
      borderDash: [4, 2],
    },
    [`${prefix}_s4`]: {
      type: 'line' as const,
      xMin: startIndex,
      xMax: endIndex,
      yMin: pivots.s4,
      yMax: pivots.s4,
      borderColor: '#089981',
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
  const { theme } = useTheme();
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<Chart | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>('15');
  const [currentType, setCurrentType] = useState<'C' | 'P'>(optionType);

  const cacheRef = useRef<{
    C: CachedData | null;
    P: CachedData | null;
    timeframe: Timeframe | null;
  }>({ C: null, P: null, timeframe: null });

  const getSymbolForType = useCallback((optType: 'C' | 'P') => {
    if (optType === optionType) return symbol;
    const currentTypeChar = optionType;
    const newTypeChar = optType;
    return symbol.replace(new RegExp(`${currentTypeChar}(\\d+)$`), `${newTypeChar}$1`);
  }, [symbol, optionType]);

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

  const renderFromCache = useCallback((optType: 'C' | 'P', tf: Timeframe) => {
    const cached = cacheRef.current[optType];
    if (!cached || !chartRef.current) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const isDark = theme === 'dark';
    const displaySymbol = getSymbolForType(optType);
    const labels = cached.ohlcData.map(bar => formatBarTime(bar.timestamp));
    const chartData = cached.ohlcData.map((bar, index) => ({
      x: index,
      o: bar.open,
      h: bar.high,
      l: bar.low,
      c: bar.close,
      v: bar.volume,
    }));

    const ctx = chartRef.current.getContext('2d');
    if (!ctx) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let annotations: any = {};
    cached.pivotData.forEach((dp, idx) => {
      annotations = { ...annotations, ...createDayPivotAnnotations(dp, idx) };
    });

    // Theme-aware colors
    const gridColor = isDark ? 'rgba(54, 58, 69, 0.3)' : 'rgba(224, 227, 235, 0.6)';
    const tickColor = isDark ? '#787b86' : '#787b86';
    const tooltipBg = isDark ? 'rgba(30, 34, 45, 0.98)' : 'rgba(255, 255, 255, 0.98)';
    const tooltipBorder = isDark ? '#434651' : '#e0e3eb';
    const monoFont = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

    chartInstanceRef.current = new Chart(ctx, {
      type: 'candlestick',
      data: {
        labels,
        datasets: [{
          label: `${displaySymbol} (${tf}m)`,
          data: chartData,
          borderColor: {
            up: '#089981',
            down: '#f23645',
            unchanged: '#2962ff',
          } as unknown as string,
          backgroundColor: {
            up: 'rgba(8, 153, 129, 0.3)',
            down: 'rgba(242, 54, 69, 0.3)',
            unchanged: 'rgba(41, 98, 255, 0.3)',
          } as unknown as string,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        font: {
          family: monoFont,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: tooltipBg,
            titleColor: isDark ? '#d1d4dc' : '#131722',
            bodyColor: isDark ? '#d1d4dc' : '#131722',
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 12,
            displayColors: false,
            titleFont: {
              family: monoFont,
              size: 12,
              weight: 'bold',
            },
            bodyFont: {
              family: monoFont,
              size: 12,
            },
            callbacks: {
              title: (items) => items.length > 0 ? labels[items[0].dataIndex] : '',
              label: (context) => {
                const dataPoint = context.raw as { o: number; h: number; l: number; c: number; v?: number };
                if (!dataPoint) return '';
                
                const idx = context.dataIndex;
                const prevClose = idx > 0 ? (context.dataset.data[idx - 1] as { c: number }).c : null;
                const change = calculatePriceChange(dataPoint.c, prevClose);
                const changeSign = change >= 0 ? '+' : '';

                return [
                  `O: ${dataPoint.o.toFixed(2)}`,
                  `H: ${dataPoint.h.toFixed(2)}`,
                  `L: ${dataPoint.l.toFixed(2)}`,
                  `C: ${dataPoint.c.toFixed(2)}`,
                  `V: ${dataPoint.v?.toLocaleString() ?? '--'}`,
                  `Change: ${changeSign}${change.toFixed(2)}%`,
                ];
              },
            },
          },
          annotation: { annotations },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: {
              wheel: { enabled: true, speed: 0.1 },
              drag: {
                enabled: true,
                backgroundColor: 'rgba(41, 98, 255, 0.2)',
                borderColor: '#2962ff',
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
            min: Math.max(0, cached.ohlcData.length - 60), // Start with last 60 candles
            max: cached.ohlcData.length - 1,
            ticks: {
              color: tickColor,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 10,
              font: {
                family: monoFont,
                size: 10,
              },
              callback: function (value) {
                const idx = Math.round(value as number);
                return idx >= 0 && idx < labels.length ? labels[idx] : '';
              },
            },
            grid: { color: gridColor },
          },
          y: {
            position: 'right',
            ticks: { 
              color: tickColor,
              font: {
                family: monoFont,
                size: 10,
              },
            },
            grid: { color: gridColor },
          },
        },
        onHover: (event, _elements, chart) => {
          const { x, y } = event;
          if (x !== null && y !== null) {
            // @ts-expect-error - custom property
            chart.crosshair = { x, y };
            chart.draw();
          }
        },
      },
    });

    // Clear crosshair on mouse leave
    chartRef.current?.addEventListener('mouseleave', () => {
      if (chartInstanceRef.current) {
        // @ts-expect-error - custom property
        chartInstanceRef.current.crosshair = null;
        chartInstanceRef.current.draw();
      }
    });
  }, [getSymbolForType, theme]);

  const loadAllData = useCallback(async (tf: Timeframe, initialType: 'C' | 'P') => {
    if (!symbol) return;

    setLoading(true);
    setError(null);
    cacheRef.current = { C: null, P: null, timeframe: null };

    try {
      const barCount = tf === '5' ? 1000 : 400;
      const ceSymbol = getSymbolForType('C');
      const peSymbol = getSymbolForType('P');

      const [ceData, peData] = await Promise.all([
        fetchOptionOhlc(ceSymbol, barCount, tf).catch(() => ({ ohlc_data: [], daily_data: [] })),
        fetchOptionOhlc(peSymbol, barCount, tf).catch(() => ({ ohlc_data: [], daily_data: [] }))
      ]);

      cacheRef.current.C = processData(ceData);
      cacheRef.current.P = processData(peData);
      cacheRef.current.timeframe = tf;

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

  useEffect(() => {
    if (isOpen) {
      setCurrentType(optionType);
    }
  }, [optionType, isOpen]);

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

  useEffect(() => {
    if (!isOpen || loading) return;

    if (cacheRef.current[currentType] && cacheRef.current.timeframe === timeframe) {
      setError(null);
      setTimeout(() => {
        renderFromCache(currentType, timeframe);
      }, 0);
    } else if (cacheRef.current.timeframe !== null) {
      setError(`No data available for ${currentType === 'C' ? 'Call' : 'Put'} option`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentType]);

  const handleTypeToggle = (newType: 'C' | 'P') => {
    if (newType !== currentType) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="
        relative w-[95vw] h-[90vh] flex flex-col
        bg-[var(--bg-secondary)] border border-[var(--border-color)]
        rounded-2xl shadow-2xl
        animate-slide-up
        overflow-hidden
      ">
        {/* Header */}
        <div className="flex-none flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-[var(--text-primary)]">
              {strike.toLocaleString()}
            </h2>
            <span className={`
              px-2 py-1 rounded-lg text-sm font-bold
              ${currentType === 'C' ? 'bg-tv-green/20 text-tv-green' : 'bg-tv-red/20 text-tv-red'}
            `}>
              {currentType === 'C' ? 'CE' : 'PE'}
            </span>
            <span className="text-[var(--text-muted)]">|</span>
            <span className="text-sm text-[var(--text-secondary)]">
              {formatExpiration(expiration)}
            </span>
          </div>

          <button
            onClick={onClose}
            className="
              p-2 rounded-lg
              text-[var(--text-muted)] hover:text-[var(--text-primary)]
              hover:bg-[var(--bg-hover)]
              transition-colors
            "
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Controls */}
        <div className="flex-none flex items-center gap-6 px-6 py-3 bg-[var(--bg-tertiary)]/50 border-b border-[var(--border-color)]">
          {/* Type Toggle */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Type</span>
            <div className="flex gap-1 p-1 bg-[var(--bg-tertiary)] rounded-lg">
              <button
                onClick={() => handleTypeToggle('C')}
                disabled={loading}
                className={`
                  px-3 py-1 rounded-md text-xs font-semibold transition-all
                  ${currentType === 'C'
                    ? 'bg-tv-green text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-tv-green'
                  }
                  disabled:opacity-50
                `}
              >
                CE
              </button>
              <button
                onClick={() => handleTypeToggle('P')}
                disabled={loading}
                className={`
                  px-3 py-1 rounded-md text-xs font-semibold transition-all
                  ${currentType === 'P'
                    ? 'bg-tv-red text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-tv-red'
                  }
                  disabled:opacity-50
                `}
              >
                PE
              </button>
            </div>
          </div>

          <div className="w-px h-6 bg-[var(--border-color)]" />

          {/* Timeframe Toggle */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">TF</span>
            <div className="flex gap-1 p-1 bg-[var(--bg-tertiary)] rounded-lg">
              <button
                onClick={() => handleTimeframeChange('5')}
                disabled={loading}
                className={`
                  px-3 py-1 rounded-md text-xs font-semibold transition-all
                  ${timeframe === '5'
                    ? 'bg-tv-blue text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-tv-blue'
                  }
                  disabled:opacity-50
                `}
              >
                5m
              </button>
              <button
                onClick={() => handleTimeframeChange('15')}
                disabled={loading}
                className={`
                  px-3 py-1 rounded-md text-xs font-semibold transition-all
                  ${timeframe === '15'
                    ? 'bg-tv-blue text-white shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-tv-blue'
                  }
                  disabled:opacity-50
                `}
              >
                15m
              </button>
            </div>
          </div>

          <div className="w-px h-6 bg-[var(--border-color)]" />

          {/* Reset Zoom */}
          <button
            onClick={() => {
              if (chartInstanceRef.current) {
                const chart = chartInstanceRef.current;
                chart.scales.y.options.min = undefined;
                chart.scales.y.options.max = undefined;
                chart.resetZoom();
              }
            }}
            disabled={loading}
            className="
              px-3 py-1 rounded-md text-xs font-medium
              bg-[var(--bg-tertiary)] text-[var(--text-secondary)]
              hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]
              transition-colors disabled:opacity-50
            "
          >
            Reset Zoom
          </button>
        </div>

        {/* Chart Container */}
        <div className="flex-1 relative p-4 min-h-0">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--bg-secondary)]/80 z-10">
              <div className="w-10 h-10 border-3 border-[var(--border-light)] border-t-tv-blue rounded-full animate-spin" />
              <p className="text-sm text-[var(--text-secondary)]">Loading market data...</p>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-tv-red/10 border border-tv-red/20 text-tv-red">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm font-medium">{error}</p>
              </div>
            </div>
          )}

          <canvas
            ref={chartRef}
            className={`w-full h-full ${loading || error ? 'invisible' : 'visible'}`}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    </div>
  );
}
