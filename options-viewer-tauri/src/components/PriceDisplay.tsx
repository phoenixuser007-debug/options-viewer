interface PriceDisplayProps {
  price: number | null;
  symbol: string;
}

export function PriceDisplay({ price, symbol }: PriceDisplayProps) {
  return (
    <div className="
      flex items-center gap-2
      px-3 py-2
      bg-[var(--bg-tertiary)] border border-[var(--border-color)]
      rounded-lg
    ">
      <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
        {symbol}
      </span>
      <span className={`
        text-base font-bold tabular-nums
        ${price ? 'text-tv-green' : 'text-[var(--text-muted)]'}
      `}>
        {price ? `₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
      </span>
    </div>
  );
}
