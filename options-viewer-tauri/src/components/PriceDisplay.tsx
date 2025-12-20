interface PriceDisplayProps {
    price: number | null;
    symbol: string;
}

export function PriceDisplay({ price, symbol }: PriceDisplayProps) {
    return (
        <div className="nifty-price-display">
            <span className="price-label">{symbol}:</span>
            <span className="price-value">
                {price ? `₹${price.toFixed(2)}` : '--'}
            </span>
        </div>
    );
}
