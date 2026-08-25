// ================================================================
// Fast In-Engine Pine Script Strategy Backtester
// Simulates strategy performance on live historical candles to provide
// empirical win rate, profit factor, and expectancy to Gemini AI.
// ================================================================

import { Candle } from '../config/types';
import { evaluatePineScript, normalizeTimeframe } from './interpreter';
import { PineStrategyDefinition } from './strategy-library';

export interface BacktestResult {
    strategyId: string;
    strategyName: string;
    totalTrades: number;
    wins: number;
    losses: number;
    winRate: number;            // 0 - 100%
    profitFactor: number;       // Gross Profit / Gross Loss (e.g. 2.1)
    netPnlPercent: number;      // Total net return % (e.g. +4.8%)
    maxDrawdownPercent: number; // Max drawdown %
    expectancy: number;         // Average return per trade in %
    status: 'profitable' | 'neutral' | 'losing' | 'no_triggers';
}

/**
 * Fast historical simulation of a Pine Script strategy on historical bars.
 */
export function backtestStrategy(
    strategy: PineStrategyDefinition,
    candleMap: Map<string, Candle[]>,
    baseTimeframe = '5m',
    windowBars = 300
): BacktestResult {
    const baseNormTf = normalizeTimeframe(baseTimeframe);
    const allBaseCandles = candleMap.get(baseNormTf) || Array.from(candleMap.values())[0] || [];

    if (!allBaseCandles || allBaseCandles.length < 30) {
        return {
            strategyId: strategy.id,
            strategyName: strategy.name,
            totalTrades: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            profitFactor: 1.0,
            netPnlPercent: 0,
            maxDrawdownPercent: 0,
            expectancy: 0,
            status: 'no_triggers',
        };
    }

    const testCandles = allBaseCandles.slice(-windowBars);
    const n = testCandles.length;

    let inPosition: 'long' | 'short' | null = null;
    let entryPrice = 0;
    let currentTp = 0;
    let currentSl = 0;

    let wins = 0;
    let losses = 0;
    let grossGains = 0;
    let grossLosses = 0;
    let peakPnl = 0;
    let maxDrawdown = 0;
    let runningPnl = 0;

    const tpPct = strategy.defaultTpPercent / 100;
    const slPct = strategy.defaultSlPercent / 100;
    const feePct = 0.0008; // 0.08% roundtrip taker fee estimate
    const slippagePct = 0.0005; // 0.05% realistic market execution slippage model
    const totalCostPct = feePct + slippagePct; // 0.13% total frictional cost per trade

    // Minimum warmup period for indicators
    const warmup = 25;

    for (let i = warmup; i < n; i++) {
        const currentBar = testCandles[i];
        const prevBar = testCandles[i - 1];

        // 1. Check if existing open position resolved on this bar
        if (inPosition) {
            let exited = false;
            let exitPrice = 0;
            let outcome: 'win' | 'loss' | null = null;

            if (inPosition === 'long') {
                if (currentBar.high >= currentTp) {
                    exitPrice = currentTp;
                    outcome = 'win';
                    exited = true;
                } else if (currentBar.low <= currentSl) {
                    exitPrice = currentSl;
                    outcome = 'loss';
                    exited = true;
                }
            } else if (inPosition === 'short') {
                if (currentBar.low <= currentTp) {
                    exitPrice = currentTp;
                    outcome = 'win';
                    exited = true;
                } else if (currentBar.high >= currentSl) {
                    exitPrice = currentSl;
                    outcome = 'loss';
                    exited = true;
                }
            }

            if (exited && outcome) {
                const rawTradePnl = inPosition === 'long'
                    ? ((exitPrice - entryPrice) / entryPrice) * 100
                    : ((entryPrice - exitPrice) / entryPrice) * 100;

                const netTradePnl = rawTradePnl - (totalCostPct * 100);

                if (outcome === 'win') {
                    wins++;
                    grossGains += Math.max(0, netTradePnl);
                } else {
                    losses++;
                    grossLosses += Math.abs(Math.min(0, netTradePnl));
                }

                runningPnl += netTradePnl;
                if (runningPnl > peakPnl) peakPnl = runningPnl;
                const dd = peakPnl - runningPnl;
                if (dd > maxDrawdown) maxDrawdown = dd;

                inPosition = null;
            }
        }

        // 2. If no open position, evaluate strategy signal on historical slice up to i
        if (!inPosition && i < n - 1) {
            const sliceCandles = testCandles.slice(0, i + 1);
            const sliceMap = new Map<string, Candle[]>();
            sliceMap.set(baseNormTf, sliceCandles);

            // Populate other timeframes proportionally if available
            for (const [tf, cList] of candleMap.entries()) {
                if (tf !== baseNormTf) {
                    const cutoffTs = currentBar.timestamp;
                    let subSlice = cList.filter(c => c.timestamp <= cutoffTs);
                    if (subSlice.length < 20 && cList.length >= 20) {
                        subSlice = cList.slice(0, 30);
                    }
                    sliceMap.set(tf, subSlice);
                }
            }

            try {
                const sig = evaluatePineScript(strategy.pineScript, sliceMap, baseTimeframe);
                if (sig.action === 'buy' || sig.action === 'sell') {
                    inPosition = sig.action === 'buy' ? 'long' : 'short';
                    entryPrice = currentBar.close;

                    // Dynamic or fallback TP / SL
                    if (inPosition === 'long') {
                        currentTp = sig.tp && sig.tp > entryPrice ? sig.tp : entryPrice * (1 + tpPct);
                        currentSl = sig.sl && sig.sl < entryPrice ? sig.sl : entryPrice * (1 - slPct);
                    } else {
                        currentTp = sig.tp && sig.tp < entryPrice ? sig.tp : entryPrice * (1 - tpPct);
                        currentSl = sig.sl && sig.sl > entryPrice ? sig.sl : entryPrice * (1 + slPct);
                    }
                }
            } catch {
                // Ignore evaluation parsing quirks on historical slices
            }
        }
    }

    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0;
    const profitFactor = grossLosses > 0
        ? Number((grossGains / grossLosses).toFixed(2))
        : grossGains > 0 ? 3.0 : 1.0;
    const netPnlPercent = Number(runningPnl.toFixed(2));
    const expectancy = totalTrades > 0 ? Number((runningPnl / totalTrades).toFixed(2)) : 0;

    let status: 'profitable' | 'neutral' | 'losing' | 'no_triggers' = 'neutral';
    if (totalTrades === 0) status = 'no_triggers';
    else if (netPnlPercent > 0.5 && profitFactor >= 1.2) status = 'profitable';
    else if (netPnlPercent < -0.5 || profitFactor < 0.9) status = 'losing';

    return {
        strategyId: strategy.id,
        strategyName: strategy.name,
        totalTrades,
        wins,
        losses,
        winRate,
        profitFactor,
        netPnlPercent,
        maxDrawdownPercent: Number(maxDrawdown.toFixed(2)),
        expectancy,
        status,
    };
}

/**
 * Run fast backtest for all strategies in library and rank them.
 */
export function backtestAllStrategies(
    strategies: PineStrategyDefinition[],
    candleMap: Map<string, Candle[]>,
    baseTimeframe = '5m',
    windowBars = 300
): BacktestResult[] {
    const results: BacktestResult[] = [];

    for (const strat of strategies) {
        try {
            const res = backtestStrategy(strat, candleMap, baseTimeframe, windowBars);
            results.push(res);
        } catch {
            // Ignore failures
        }
    }

    // Sort by Total Trades > 0, then Net PnL desc, then Profit Factor desc
    return results.sort((a, b) => {
        if (a.totalTrades > 0 && b.totalTrades === 0) return -1;
        if (a.totalTrades === 0 && b.totalTrades > 0) return 1;
        if (b.netPnlPercent !== a.netPnlPercent) return b.netPnlPercent - a.netPnlPercent;
        return b.profitFactor - a.profitFactor;
    });
}
