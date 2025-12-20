import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { OptionsTable } from './OptionsTable';
import { StrikeData } from '../types';

const mockStrikes: StrikeData[] = [
  {
    strike: 24000,
    call: {
      ask: 100.5,
      bid: 99.5,
      iv: 0.155,
      delta: 0.55,
      gamma: 0.0012,
      theta: -15.5,
      vega: 20.5,
      rho: 0.05,
      strike: 24000,
      'option-type': 'C',
      currency: 'INR',
      expiration: 123456789,
      pricescale: 100,
      root: 'NIFTY',
      bid_iv: null,
      ask_iv: null,
      theoPrice: null
    },
    put: {
      ask: 80.5,
      bid: 79.5,
      iv: 0.145,
      delta: -0.45,
      gamma: 0.0011,
      theta: -12.5,
      vega: 18.5,
      rho: -0.04,
      strike: 24000,
      'option-type': 'P',
      currency: 'INR',
      expiration: 123456789,
      pricescale: 100,
      root: 'NIFTY',
      bid_iv: null,
      ask_iv: null,
      theoPrice: null
    }
  }
];

describe('OptionsTable formatting and alignment', () => {
  it('should use monospaced fonts for numerical values', () => {
    render(
      <OptionsTable 
        strikes={mockStrikes} 
        currentPrice={24000} 
        onOptionClick={vi.fn()} 
      />
    );
    
    // Check if the strike price cell has 'font-mono' class
    const strikeCell = screen.getByText('24,000');
    // Note: We expect this to FAIL initially
    expect(strikeCell.parentElement).toHaveClass('font-mono');
  });

  it('should right-align numerical columns', () => {
    render(
      <OptionsTable 
        strikes={mockStrikes} 
        currentPrice={24000} 
        onOptionClick={vi.fn()} 
      />
    );
    
    // Ask price for call
    const callAsk = screen.getByText('100.50');
    // Note: We expect this to FAIL initially as it's currently text-center
    expect(callAsk).toHaveClass('text-right');
  });

  it('should have zebra striping', () => {
    render(
      <OptionsTable 
        strikes={mockStrikes} 
        currentPrice={24000} 
        onOptionClick={vi.fn()} 
      />
    );
    
    const row = screen.getByText('24,000').closest('.grid');
    // Note: We expect this to FAIL initially
    expect(row).toHaveClass('even:bg-[var(--bg-hover)]');
  });
});
