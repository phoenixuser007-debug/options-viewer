import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { OptionsTable } from './OptionsTable';
import { StrikeData } from '../types';

const mockStrikes: StrikeData[] = [
  {
    strike: 24000,
    call: null,
    put: null
  },
  {
    strike: 24100,
    call: null,
    put: null
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
    
    // Check if the row container has 'font-mono' class
    const strikeCell = screen.getByText('24,000');
    expect(strikeCell.parentElement).toHaveClass('font-mono');
  });

  it('should right-align numerical columns', () => {
    const strikesWithData: StrikeData[] = [{
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
      put: null
    }];

    render(
      <OptionsTable 
        strikes={strikesWithData} 
        currentPrice={24100} 
        onOptionClick={vi.fn()} 
      />
    );
    
    const callAsk = screen.getByText('100.50');
    expect(callAsk).toHaveClass('text-right');
  });

  it('should have zebra striping', () => {
    render(
      <OptionsTable 
        strikes={mockStrikes} 
        currentPrice={23000} // Make both non-ATM
        onOptionClick={vi.fn()} 
      />
    );
    
    const rows = screen.getAllByText(/24,(0|1)00/).map(cell => cell.parentElement);
    expect(rows[0]).toHaveClass('even:bg-[var(--bg-hover)]');
  });
});
