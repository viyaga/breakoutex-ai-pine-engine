// ================================================================
// BreakoutEx AI — Backtest Comparison
// ================================================================

import {
    BacktestResult,
} from './types';

export interface ComparisonTolerance {
    pnlPercent: number;
    price: number;
    metric: number;
}

export const DEFAULT_COMPARISON_TOLERANCE: ComparisonTolerance = {
    pnlPercent: 0.01,
    price: 0.00000001,
    metric: 0.01,
};

export interface BacktestComparison {

    tradesMatch: boolean;

    pnlDifferencePercent: number;

    winRateDifference: number;

    profitFactorDifference: number;

    drawdownDifference: number;

    firstTradeDifference?: string;

    warnings: string[];
}

export function compareBacktests(
    oldResult: BacktestResult,
    newResult: BacktestResult,
    tolerance: ComparisonTolerance = DEFAULT_COMPARISON_TOLERANCE
): BacktestComparison {

    const warnings: string[] = [];

    const pnlDifferencePercent =
        Math.abs(
            oldResult.netPnlPercent -
            newResult.netPnlPercent
        );

    const winRateDifference =
        Math.abs(
            oldResult.winRate -
            newResult.winRate
        );

    const profitFactorDifference =
        Math.abs(
            oldResult.profitFactor -
            newResult.profitFactor
        );

    const drawdownDifference =
        Math.abs(
            oldResult.maxDrawdownPercent -
            newResult.maxDrawdownPercent
        );

    const tradesMatch =
        oldResult.totalTrades ===
        newResult.totalTrades;

    if (!tradesMatch) {

        warnings.push(
            `Trade count differs: ` +
            `${oldResult.totalTrades} vs ` +
            `${newResult.totalTrades}`
        );
    }

    if (
        pnlDifferencePercent >
        tolerance.pnlPercent
    ) {

        warnings.push(
            `P&L differs by ` +
            `${pnlDifferencePercent.toFixed(4)}%`
        );
    }

    if (
        winRateDifference >
        tolerance.metric
    ) {

        warnings.push(
            `Win rate differs by ` +
            `${winRateDifference.toFixed(4)}%`
        );
    }

    if (
        drawdownDifference >
        tolerance.metric
    ) {

        warnings.push(
            `Drawdown differs by ` +
            `${drawdownDifference.toFixed(4)}%`
        );
    }

    let firstTradeDifference:
        string | undefined;

    const count =
        Math.min(
            oldResult.trades.length,
            newResult.trades.length
        );

    for (
        let i = 0;
        i < count;
        i++
    ) {

        const oldTrade =
            oldResult.trades[i];

        const newTrade =
            newResult.trades[i];

        if (
            oldTrade.side !==
            newTrade.side
        ) {

            firstTradeDifference =
                `Trade ${i + 1}: side differs (${oldTrade.side} vs ${newTrade.side})`;

            break;
        }

        if (
            Math.abs(
                oldTrade.entryPrice -
                newTrade.entryPrice
            ) > tolerance.price
        ) {

            firstTradeDifference =
                `Trade ${i + 1}: entry price differs (${oldTrade.entryPrice} vs ${newTrade.entryPrice})`;

            break;
        }

        if (
            Math.abs(
                oldTrade.exitPrice -
                newTrade.exitPrice
            ) > tolerance.price
        ) {

            firstTradeDifference =
                `Trade ${i + 1}: exit price differs (${oldTrade.exitPrice} vs ${newTrade.exitPrice})`;

            break;
        }

        if (
            oldTrade.exitReason !==
            newTrade.exitReason
        ) {

            firstTradeDifference =
                `Trade ${i + 1}: exit reason differs (${oldTrade.exitReason} vs ${newTrade.exitReason})`;

            break;
        }
    }

    if (
        firstTradeDifference
    ) {

        warnings.push(
            firstTradeDifference
        );
    }

    return {

        tradesMatch,

        pnlDifferencePercent,

        winRateDifference,

        profitFactorDifference,

        drawdownDifference,

        firstTradeDifference,

        warnings,
    };
}
