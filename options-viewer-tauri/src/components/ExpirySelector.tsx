import type { ExpirationInfo } from '../types';

interface ExpirySelectorProps {
    expirations: ExpirationInfo[];
    selectedExpiration: number | null;
    onSelect: (expiration: number) => void;
}

export function ExpirySelector({ expirations, selectedExpiration, onSelect }: ExpirySelectorProps) {
    return (
        <div className="expiry-buttons-compact">
            {expirations.map((exp) => (
                <button
                    key={exp.value}
                    className={`expiry-btn ${selectedExpiration === exp.value ? 'active' : ''}`}
                    onClick={() => onSelect(exp.value)}
                >
                    {exp.formatted}
                </button>
            ))}
        </div>
    );
}
