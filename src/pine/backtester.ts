// ================================================================
// Fast In-Engine Pine Script Strategy Backtester
// Simulates strategy performance on live historical candles to provide
// empirical win rate, profit factor, and expectancy to Gemini AI.
// ================================================================

import { Candle } from '../config/types';
import { evaluatePineScript, normalizeTimeframe } from './interpreter';
import { PineStrategyDefinition } from './strategy-library';

export type BacktestStatus =
    | 'profitable'
    | 'neutral'
    | 'losing'
    | 'insufficient_sample'
    | 'no_triggers';

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
    status: BacktestStatus;
}

// Explicit Institutional Friction Constants
const ENTRY_FEE_PCT = 0.0004;       // 0.04% taker entry fee
const EXIT_FEE_PCT = 0.0004;        // 0.04% taker exit fee
const ENTRY_SLIPPAGE_PCT = 0.0003;  // 0.03% realistic entry slippage
const EXIT_SLIPPAGE_PCT = 0.0003;   // 0.03% realistic exit slippage
const TOTAL_FRICTION_PCT = ENTRY_FEE_PCT + EXIT_FEE_PCT + ENTRY_SLIPPAGE_PCT + EXIT_SLIPPAGE_PCT; // 0.14% roundtrip

const MIN_SAMPLE_SIZE = 4; // Minimum trades required for statistical validity

/**
 * Fast historical simulation of a Pine Script strategy on historical bars.
 */
export function backtestStrategy(
    strategy: PineStrategyDefinition,
    candleMap: Map<string, Candle[]>,
    baseTimeframe = '5m',
    windowBars = 500
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

    // Minimum warmup period for indicators
    const warmup = 25;

    for (let i = warmup; i < n; i++) {
        const currentBar = testCandles[i];

        // 1. Check if existing open position resolved on this bar
        if (inPosition) {
            let exited = false;
            let exitPrice = 0;
            let outcome: 'win' | 'loss' | null = null;

            if (inPosition === 'long') {
                const hitTp = currentBar.high >= currentTp;
                const hitSl = currentBar.low <= currentSl;

                if (hitTp && hitSl) {
                    // Conservative: simultaneous breach treats Stop Loss as hit first
                    exitPrice = currentSl;
                    outcome = 'loss';
                    exited = true;
                } else if (hitTp) {
                    exitPrice = currentTp;
                    outcome = 'win';
                    exited = true;
                } else if (hitSl) {
                    exitPrice = currentSl;
                    outcome = 'loss';
                    exited = true;
                }
            } else if (inPosition === 'short') {
                const hitTp = currentBar.low <= currentTp;
                const hitSl = currentBar.high >= currentSl;

                if (hitTp && hitSl) {
                    // Conservative: simultaneous breach treats Stop Loss as hit first
                    exitPrice = currentSl;
                    outcome = 'loss';
                    exited = true;
                } else if (hitTp) {
                    exitPrice = currentTp;
                    outcome = 'win';
                    exited = true;
                } else if (hitSl) {
                    exitPrice = currentSl;
                    outcome = 'loss';
                    exited = true;
                }
            }

            if (exited && outcome) {
                const rawTradePnl = inPosition === 'long'
                    ? ((exitPrice - entryPrice) / entryPrice) * 100
                    : ((entryPrice - exitPrice) / entryPrice) * 100;

                const netTradePnl = rawTradePnl - (TOTAL_FRICTION_PCT * 100);

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

        // 2. If no open position, evaluate strategy signal on strict historical slice up to i
        if (!inPosition && i < n - 1) {
            const sliceCandles = testCandles.slice(0, i + 1);
            const sliceMap = new Map<string, Candle[]>();
            sliceMap.set(baseNormTf, sliceCandles);

            // Populate other timeframes strictly up to currentBar.timestamp (zero lookahead bias)
            for (const [tf, cList] of candleMap.entries()) {
                if (tf !== baseNormTf) {
                    const cutoffTs = currentBar.timestamp;
                    const subSlice = cList.filter(c => c.timestamp <= cutoffTs);
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
                // Ignore evaluation parsing quirks on early historical slices
            }
        }
    }

    // 3. Mark-to-market any open position at end of backtest window
    if (inPosition && n > 0) {
        const finalBar = testCandles[n - 1];
        const exitPrice = finalBar.close;
        const rawTradePnl = inPosition === 'long'
            ? ((exitPrice - entryPrice) / entryPrice) * 100
            : ((entryPrice - exitPrice) / entryPrice) * 100;

        const netTradePnl = rawTradePnl - (TOTAL_FRICTION_PCT * 100);

        if (netTradePnl > 0) {
            wins++;
            grossGains += netTradePnl;
        } else {
            losses++;
            grossLosses += Math.abs(netTradePnl);
        }

        runningPnl += netTradePnl;
        if (runningPnl > peakPnl) peakPnl = runningPnl;
        const dd = peakPnl - runningPnl;
        if (dd > maxDrawdown) maxDrawdown = dd;

        inPosition = null;
    }

    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0;
    const profitFactor = grossLosses > 0
        ? Number((grossGains / grossLosses).toFixed(2))
        : grossGains > 0 ? 3.0 : 1.0;
    const netPnlPercent = Number(runningPnl.toFixed(2));
    const expectancy = totalTrades > 0 ? Number((runningPnl / totalTrades).toFixed(2)) : 0;

    let status: BacktestStatus = 'neutral';
    if (totalTrades === 0) {
        status = 'no_triggers';
    } else if (totalTrades < MIN_SAMPLE_SIZE) {
        status = 'insufficient_sample';
    } else if (netPnlPercent > 0.5 && profitFactor >= 1.2) {
        status = 'profitable';
    } else if (netPnlPercent < -0.5 || profitFactor < 0.9) {
        status = 'losing';
    }

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
    windowBars = 500
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

    const statusPriority: Record<BacktestStatus, number> = {
        profitable: 1,
        neutral: 2,
        insufficient_sample: 3,
        no_triggers: 4,
        losing: 5,
    };

    // Sort by status tier first, then Net PnL desc, then Profit Factor desc
    return results.sort((a, b) => {
        const priorityA = statusPriority[a.status] ?? 3;
        const priorityB = statusPriority[b.status] ?? 3;

        if (priorityA !== priorityB) return priorityA - priorityB;
        if (b.netPnlPercent !== a.netPnlPercent) return b.netPnlPercent - a.netPnlPercent;
        return b.profitFactor - a.profitFactor;
    });
}
