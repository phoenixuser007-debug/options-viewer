import { useMemo, useCallback } from 'react';
import type { StrikeData, OptionData } from '../types';

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

function getColorClass(value: number | null): string {
    if (value === null || value === undefined) return '';
    return Number(value) >= 0 ? 'positive' : 'negative';
}

interface OptionCellsProps {
    option: OptionData | null;
    type: 'call' | 'put';
}

function OptionCells({ option, type }: OptionCellsProps) {
    const dataClass = type === 'call' ? 'call-data' : 'put-data';

    if (!option) {
        return (
            <>
                <td className={dataClass}>--</td>
                <td className={dataClass}>--</td>
                <td className={dataClass}>--</td>
                <td className={`${dataClass} greek-cell`}>--</td>
                <td className={`${dataClass} greek-cell`}>--</td>
                <td className={`${dataClass} greek-cell`}>--</td>
                <td className={`${dataClass} greek-cell`}>--</td>
                <td className={`${dataClass} greek-cell`}>--</td>
            </>
        );
    }

    return (
        <>
            <td className={dataClass}>{formatValue(option.bid)}</td>
            <td className={dataClass}>{formatValue(option.ask)}</td>
            <td className={`${dataClass} iv-cell`}>{formatPercent(option.iv)}</td>
            <td className={`${dataClass} greek-cell ${getColorClass(option.delta)}`}>{formatValue(option.delta, 3)}</td>
            <td className={`${dataClass} greek-cell`}>{formatValue(option.gamma, 3)}</td>
            <td className={`${dataClass} greek-cell ${getColorClass(option.theta)}`}>{formatValue(option.theta, 3)}</td>
            <td className={`${dataClass} greek-cell`}>{formatValue(option.vega, 3)}</td>
            <td className={`${dataClass} greek-cell`}>{formatValue(option.rho, 3)}</td>
        </>
    );
}

export function OptionsTable({ strikes, currentPrice, onOptionClick }: OptionsTableProps) {
    const handleClick = useCallback((strike: number, cellIndex: number) => {
        // Cells 0-7 are CALL side, cell 8 is strike, cells 9-16 are PUT side
        const optionType: 'C' | 'P' = cellIndex < 8 ? 'C' : 'P';
        onOptionClick(strike, optionType);
    }, [onOptionClick]);

    const rows = useMemo(() => {
        return strikes.map((strikeData) => {
            const isATM = Math.abs(strikeData.strike - currentPrice) < 50;

            return (
                <tr
                    key={strikeData.strike}
                    className={isATM ? 'atm-strike' : ''}
                    onClick={(e) => {
                        const target = e.target as HTMLElement;
                        const cellIndex = Array.from(target.parentElement?.children || []).indexOf(target);
                        handleClick(strikeData.strike, cellIndex);
                    }}
                >
                    <OptionCells option={strikeData.call} type="call" />
                    <td className="strike-cell">{strikeData.strike.toLocaleString()}</td>
                    <OptionCells option={strikeData.put} type="put" />
                </tr>
            );
        });
    }, [strikes, currentPrice, handleClick]);

    return (
        <div className="options-container glass">
            <div className="table-wrapper">
                <table className="options-table">
                    <thead>
                        <tr>
                            <th colSpan={8} className="call-header">Calls</th>
                            <th className="strike-header">Strike</th>
                            <th colSpan={8} className="put-header">Puts</th>
                        </tr>
                        <tr className="sub-header">
                            <th>Bid</th>
                            <th>Ask</th>
                            <th>IV</th>
                            <th>Δ Delta</th>
                            <th>Γ Gamma</th>
                            <th>Θ Theta</th>
                            <th>ν Vega</th>
                            <th>ρ Rho</th>
                            <th className="strike-cell">Price</th>
                            <th>Bid</th>
                            <th>Ask</th>
                            <th>IV</th>
                            <th>Δ Delta</th>
                            <th>Γ Gamma</th>
                            <th>Θ Theta</th>
                            <th>ν Vega</th>
                            <th>ρ Rho</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
