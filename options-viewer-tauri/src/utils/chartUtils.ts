/**
 * Calculates the percentage change between current price and previous price.
 * Returns 0 if previous price is null or zero.
 */
export function calculatePriceChange(current: number, previous: number | null): number {
  if (previous === null || previous === 0) {
    return 0;
  }
  return ((current - previous) / previous) * 100;
}
