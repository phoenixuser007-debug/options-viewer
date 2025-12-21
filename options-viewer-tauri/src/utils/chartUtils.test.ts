import { describe, it, expect } from 'vitest';
import { calculatePriceChange } from './chartUtils';

describe('calculatePriceChange', () => {
  it('should return 0 for the first bar', () => {
    expect(calculatePriceChange(100, null)).toBe(0);
  });

  it('should calculate positive price change percentage', () => {
    expect(calculatePriceChange(110, 100)).toBe(10);
  });

  it('should calculate negative price change percentage', () => {
    expect(calculatePriceChange(90, 100)).toBe(-10);
  });

  it('should handle zero previous price', () => {
    expect(calculatePriceChange(100, 0)).toBe(0);
  });
});
