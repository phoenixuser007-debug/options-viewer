import { useMemo, useState, useEffect, useRef } from 'react';
import type { StrikeData } from '../types';

interface OptionsTableProps {
  strikes: StrikeData[];
  currentPrice: number;
  onOptionClick: (strike: number, optionType: 'C' | 'P') => void;
}

function formatValue(value: number | null, decimals = 2): string {
  if (value === null || value === undefined) return '--';
  return Number(value).toFixed(decimals);
}

function formatPercent(value: number | null): string {
  if (value === null || value === undefined) return '--';
  return (Number(value) * 100).toFixed(1) + '%';
}

function FlashCell({ value, className }: { value: string; className: string; color?: string }) {
  const [flash, setFlash] = useState<'green' | 'red' | null>(null);
  const prevValue = useRef<string>('');

  useEffect(() => {
    const prev = prevValue.current;
    prevValue.current = value;
    if (prev === '' || prev === value) return;

    const prevNum = parseFloat(prev);
    const nextNum = parseFloat(value);
    if (isNaN(prevNum) || isNaN(nextNum)) return;

    setFlash(nextNum > prevNum ? 'green' : 'red');
    const timer = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(timer);
  }, [value]);

  const animStyle = flash
    ? { animation: `flash-${flash} 0.6s ease-out forwards` }
    : undefined;

  return (
    <div className={className} style={animStyle}>
      {value}
    </div>
  );
}

const CALL_HEADERS = ['Rho', 'Vega', 'Theta', 'Gamma', 'Delta', 'IV', 'Ask', 'Bid', 'Volume'];
const PUT_HEADERS = ['Volume', 'Bid', 'Ask', 'IV', 'Delta', 'Gamma', 'Theta', 'Vega', 'Rho'];

function formatVolume(volume: number | null): string {
  if (volume === null || volume === undefined) return '--';
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(0)}K`;
  return volume.toString();
}

function VolumeBar({ volume, maxVolume, side }: { volume: number | null; maxVolume: number; side: 'call' | 'put' }) {
  const pct = volume !== null && volume !== undefined && maxVolume > 0
    ? Math.min(100, (volume / maxVolume) * 100)
    : 0;
  const barColor = side === 'call' ? 'bg-tv-green/25' : 'bg-tv-red/25';
  const justify = side === 'call' ? 'justify-end' : 'justify-start';
  const barAlign = side === 'call' ? 'right-0' : 'left-0';

  return (
    <div className={`relative px-1 overflow-hidden h-full flex items-center ${justify}`}>
      {pct > 0 && (
        <div
          className={`absolute top-0 bottom-0 ${barColor} ${barAlign}`}
          style={{ width: `${pct}%` }}
        />
      )}
      <span className="relative z-10 font-mono text-[10px] text-[var(--text-secondary)]">
        {formatVolume(volume)}
      </span>
    </div>
  );
}

// Base cell styles
const cellBase = 'px-1 overflow-hidden truncate font-mono text-right';

export function OptionsTable({ strikes, currentPrice, onOptionClick }: OptionsTableProps) {
  const { rows, maxCallVolume, maxPutVolume } = useMemo(() => {
    let maxCall = 0;
    let maxPut = 0;
    for (const s of strikes) {
      if (s.call?.volume) maxCall = Math.max(maxCall, s.call.volume);
      if (s.put?.volume) maxPut = Math.max(maxPut, s.put.volume);
    }
    const rows = strikes.map((strikeData) => {
      const isATM = Math.abs(strikeData.strike - currentPrice) < 50;
      const isITMCall = strikeData.strike < currentPrice;
      const isITMPut = strikeData.strike > currentPrice;
      return { strikeData, isATM, isITMCall, isITMPut };
    });
    return { rows, maxCallVolume: maxCall, maxPutVolume: maxPut };
  }, [strikes, currentPrice]);

  return (
    <div className="h-full flex flex-col rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] overflow-hidden">
      {/* Main Header */}
      <div className="flex-none grid grid-cols-19 bg-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
        <div className="col-span-9 px-2 py-2 text-center font-bold text-tv-green text-sm truncate">
          CALLS
        </div>
        <div className="col-span-1 px-2 py-2 text-center font-bold text-tv-purple text-sm bg-[var(--bg-hover)] truncate">
          STRIKE
        </div>
        <div className="col-span-9 px-2 py-2 text-center font-bold text-tv-red text-sm truncate">
          PUTS
        </div>
      </div>

      {/* Sub Header */}
      <div className="flex-none grid grid-cols-19 bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-xs uppercase tracking-wider border-b border-[var(--border-color)]">
        {CALL_HEADERS.map((h, i) => (
          <div key={`ch-${i}`} className={`px-1 py-2 font-semibold truncate ${h === 'Volume' ? 'text-center' : 'text-right'}`}>{h}</div>
        ))}
        <div className="px-1 py-2 text-center font-semibold bg-[var(--bg-hover)] truncate">Price</div>
        {PUT_HEADERS.map((h, i) => (
          <div key={`ph-${i}`} className={`px-1 py-2 font-semibold truncate ${h === 'Volume' ? 'text-center' : 'text-right'}`}>{h}</div>
        ))}
      </div>

      {/* Body - rows fill remaining space equally */}
      <div className="flex-1 flex flex-col min-h-0 overflow-auto">
        {rows.map(({ strikeData, isATM, isITMCall, isITMPut }) => {
          const callBg = isITMCall ? 'bg-tv-green/5' : '';
          const putBg = isITMPut ? 'bg-tv-red/5' : '';
          const rowBg = isATM ? 'bg-tv-blue/10' : 'even:bg-[var(--bg-hover)]';

          return (
            <div
              key={strikeData.strike}
              className={`flex-1 min-h-[40px] grid grid-cols-19 items-center border-b border-[var(--border-color)] text-xs transition-colors font-mono ${rowBg}`}
            >
              {/* Call side - entire section clickable */}
              <div
                onClick={() => strikeData.call && onOptionClick(strikeData.strike, 'C')}
                className={`col-span-9 grid grid-cols-9 items-center h-full cursor-pointer transition-colors hover:bg-tv-green/10 ${callBg} ${strikeData.call ? '' : 'cursor-default'}`}
              >
                <FlashCell
                  value={strikeData.call ? formatValue(strikeData.call.rho, 4) : '--'}
                  className={`${cellBase} text-[var(--text-secondary)]`}
                  color="green"
                />
                <FlashCell
                  value={strikeData.call ? formatValue(strikeData.call.vega, 4) : '--'}
                  className={`${cellBase} text-[var(--text-secondary)]`}
                  color="green"
                />
                <FlashCell
                  value={strikeData.call ? formatValue(strikeData.call.theta, 4) : '--'}
                  className={`${cellBase} ${strikeData.call?.theta !== null && strikeData.call?.theta !== undefined && Number(strikeData.call.theta) < 0 ? 'text-tv-red' : 'text-tv-green'}`}
                  color="green"
                />
                <FlashCell
                  value={strikeData.call ? formatValue(strikeData.call.gamma, 4) : '--'}
                  className={`${cellBase} text-[var(--text-secondary)]`}
                  color="green"
                />
                <FlashCell
                  value={strikeData.call ? formatValue(strikeData.call.delta, 4) : '--'}
                  className={`${cellBase} text-tv-green font-medium`}
                  color="green"
                />
                <FlashCell
                  value={strikeData.call ? formatPercent(strikeData.call.iv) : '--'}
                  className={`${cellBase} font-bold text-[var(--text-primary)]`}
                  color="green"
                />
                <FlashCell
                  value={strikeData.call ? formatValue(strikeData.call.ask, 2) : '--'}
                  className={`${cellBase} font-semibold text-tv-green`}
                  color="green"
                />
                <FlashCell
                  value={strikeData.call ? formatValue(strikeData.call.bid, 2) : '--'}
                  className={`${cellBase} font-semibold text-tv-green`}
                  color="green"
                />
                <VolumeBar volume={strikeData.call?.volume ?? null} maxVolume={maxCallVolume} side="call" />
              </div>

              {/* Strike */}
              <div className={`px-1 text-center font-bold text-sm bg-[var(--bg-tertiary)] h-full flex items-center justify-center border-x border-[var(--border-light)] overflow-hidden ${isATM ? 'text-tv-blue bg-tv-blue/20' : 'text-tv-purple'}`}>
                {strikeData.strike.toLocaleString()}
              </div>

              {/* Put side - entire section clickable */}
              <div
                onClick={() => strikeData.put && onOptionClick(strikeData.strike, 'P')}
                className={`col-span-9 grid grid-cols-9 items-center h-full cursor-pointer transition-colors hover:bg-tv-red/10 ${putBg} ${strikeData.put ? '' : 'cursor-default'}`}
              >
                <VolumeBar volume={strikeData.put?.volume ?? null} maxVolume={maxPutVolume} side="put" />
                <FlashCell
                  value={strikeData.put ? formatValue(strikeData.put.bid, 2) : '--'}
                  className={`${cellBase} font-semibold text-tv-red`}
                  color="red"
                />
                <FlashCell
                  value={strikeData.put ? formatValue(strikeData.put.ask, 2) : '--'}
                  className={`${cellBase} font-semibold text-tv-red`}
                  color="red"
                />
                <FlashCell
                  value={strikeData.put ? formatPercent(strikeData.put.iv) : '--'}
                  className={`${cellBase} font-bold text-[var(--text-primary)]`}
                  color="red"
                />
                <FlashCell
                  value={strikeData.put ? formatValue(strikeData.put.delta, 4) : '--'}
                  className={`${cellBase} text-tv-red font-medium`}
                  color="red"
                />
                <FlashCell
                  value={strikeData.put ? formatValue(strikeData.put.gamma, 4) : '--'}
                  className={`${cellBase} text-[var(--text-secondary)]`}
                  color="red"
                />
                <FlashCell
                  value={strikeData.put ? formatValue(strikeData.put.theta, 4) : '--'}
                  className={`${cellBase} ${strikeData.put?.theta !== null && strikeData.put?.theta !== undefined && Number(strikeData.put.theta) < 0 ? 'text-tv-red' : 'text-tv-green'}`}
                  color="red"
                />
                <FlashCell
                  value={strikeData.put ? formatValue(strikeData.put.vega, 4) : '--'}
                  className={`${cellBase} text-[var(--text-secondary)]`}
                  color="red"
                />
                <FlashCell
                  value={strikeData.put ? formatValue(strikeData.put.rho, 4) : '--'}
                  className={`${cellBase} text-[var(--text-secondary)]`}
                  color="red"
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
