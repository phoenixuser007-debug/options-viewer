import type { ExpirationInfo } from '../types';

interface ExpirySelectorProps {
  expirations: ExpirationInfo[];
  selectedExpiration: number | null;
  onSelect: (expiration: number) => void;
}

// Format expiration to short format like "30 Dec"
function formatShortDate(exp: ExpirationInfo): string {
  // exp.value is in YYYYMMDD format
  const dateStr = exp.value.toString();
  if (dateStr.length !== 8) return exp.formatted;
  
  const month = parseInt(dateStr.slice(4, 6)) - 1;
  const day = parseInt(dateStr.slice(6, 8));
  
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  return `${day} ${monthNames[month]}`;
}

export function ExpirySelector({ expirations, selectedExpiration, onSelect }: ExpirySelectorProps) {
  if (expirations.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-0.5">
      {expirations.map((exp) => (
        <button
          key={exp.value}
          onClick={() => onSelect(exp.value)}
          className={`
            px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap
            transition-all duration-150
            ${selectedExpiration === exp.value
              ? 'bg-tv-blue text-white'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }
          `}
        >
          {formatShortDate(exp)}
        </button>
      ))}
    </div>
  );
}
