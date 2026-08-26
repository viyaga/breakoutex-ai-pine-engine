// ================================================================
// BreakoutEx AI — Dual-Execution Comparison Engine (Ideal vs Realistic)
//
// Compares frictionless naive backtests against realistic exchange microstructure
// execution costs to determine if strategy edge survives real-world trading.
// ================================================================

import { Candle } from '../config/types';
import { PineStrategyDefinition } from './strategy-library';
import { BacktestOptions, BacktestResult, BacktestTrade } from './types';
import { Backtester } from './Backtester';
import { ExchangeContractSpec, ExchangeConfig } from './ExchangeConfig';
import { ExecutionSimulator } from './ExecutionSimulator';
import { normalizeTimeframe } from '../interpreter';

export interface FrictionCostBreakdown {
    totalMakerFees: number;
    totalTakerFees: number;
    totalSlippageCost: number;
    totalSpreadCost: number;
    totalFundingCost: number;
    totalGapLosses: number;
    totalFrictionDollars: number;
    totalFrictionPercent: number; // Friction cost as % of initial capital
}

export type FrictionVerdict =
    | 'PROFITABLE_AFTER_FRICTION'
    | 'MARGINAL_EDGE_BLEED'
    | 'UNPROFITABLE_DUE_TO_FRICTION';

export interface ExecutionComparisonReport {
    strategyId: string;
    strategyName: string;
    exchangeName: string;

    // Dual Simulation Results
    idealResult: BacktestResult;
    realisticResult: BacktestResult;

    // Detailed Microstructure Cost Breakdown
    frictionCostBreakdown: FrictionCostBreakdown;

    // Comparative Metrics
    netReturnDegradationPercent: number; // Difference in net return (Ideal - Realistic)
    sharpeDegradationPercent: number; // Difference in Sharpe ratio
    drawdownExpansionPercent: number; // Increase in max drawdown
    edgeRetentionRatio: number; // Realistic Return / Ideal Return
    isEdgePreservedAfterFriction: boolean;
    verdict: FrictionVerdict;

    keyFrictionInsights: string[];
}

export interface ExecutionComparisonRequest {
    strategy: PineStrategyDefinition | string;
    candleMap: Map<string, Candle[]> | Record<string, Candle[]>;
    exchange?: string | ExchangeContractSpec;
    options?: BacktestOptions;
    timeframe?: string;
}

import { STRATEGY_LIBRARY } from './strategy-library';

export class ExecutionComparisonEngine {

    /**
     * Run dual execution backtests (Ideal vs Realistic Exchange Microstructure) and produce friction comparison.
     */
    static compare(request: ExecutionComparisonRequest): ExecutionComparisonReport {
        const spec = ExchangeConfig.getSpec(request.exchange);
        const baseTf = normalizeTimeframe(request.timeframe ?? request.options?.baseTimeframe ?? '5m');

        // Resolve candle map
        let candleMap: Map<string, Candle[]>;
        if (request.candleMap instanceof Map) {
            candleMap = request.candleMap;
        } else {
            candleMap = new Map<string, Candle[]>();
            for (const [tf, candles] of Object.entries(request.candleMap)) {
                candleMap.set(normalizeTimeframe(tf), candles);
            }
        }

        const strategyDef = typeof request.strategy === 'string'
            ? STRATEGY_LIBRARY[request.strategy] || STRATEGY_LIBRARY.mtf_trend_continuation
            : request.strategy;

        const baseOptions = request.options ?? {};

        // ------------------------------------------------------------
        // 1. Ideal (Frictionless / Zero Fees & Zero Slippage) Run
        // ------------------------------------------------------------
        const idealOptions: BacktestOptions = {
            ...baseOptions,
            fees: {
                entryPct: 0,
                exitPct: 0,
                makerFeePercent: 0,
                takerFeePercent: 0,
            },
            slippage: {
                entryPct: 0,
                exitPct: 0,
            },
            performance: {
                enabled: true,
                usePrecomputedIndicators: true,
                useCompiledScript: true,
                zeroCopySnapshots: true,
                ...baseOptions.performance,
            },
        };

        const idealResult = Backtester.run({
            strategy: strategyDef,
            candleMap,
            options: idealOptions,
        });

        // ------------------------------------------------------------
        // 2. Realistic Microstructure Cost Run
        // ------------------------------------------------------------
        const slipVal = spec.baseSlippagePercent + (spec.bidAskSpreadPercent / 2);
        const realisticOptions: BacktestOptions = {
            ...baseOptions,
            fees: {
                entryPct: spec.takerFeePercent,
                exitPct: spec.takerFeePercent,
                makerFeePercent: spec.makerFeePercent,
                takerFeePercent: spec.takerFeePercent,
            },
            slippage: {
                entryPct: slipVal,
                exitPct: slipVal,
            },
            performance: {
                enabled: true,
                usePrecomputedIndicators: true,
                useCompiledScript: true,
                zeroCopySnapshots: true,
                ...baseOptions.performance,
            },
        };

        const realisticResult = Backtester.run({
            strategy: strategyDef,
            candleMap,
            options: realisticOptions,
        });

        // ------------------------------------------------------------
        // 3. Detailed Friction Cost Accounting
        // ------------------------------------------------------------
        const initCap = idealResult.initialCapital || 10000;
        const baseCandles = candleMap.get(baseTf) ?? [];
        const baseCandleLength = Math.max(1, baseCandles.length);

        let totalMakerFees = 0;
        let totalTakerFees = 0;
        let totalSlippageCost = 0;
        let totalSpreadCost = 0;
        let totalGapLosses = 0;
        let totalFundingCost = 0;

        // Process realistic trades for micro-friction breakdowns
        for (const trade of realisticResult.trades) {
            const tradeQty = trade.quantity ?? trade.size ?? 1;
            const entryVal = (trade.entryPrice * tradeQty);
            const exitVal = ((trade.exitPrice ?? trade.entryPrice) * tradeQty);

            // Fee calculations
            const takerRate = spec.takerFeePercent / 100;
            const makerRate = spec.makerFeePercent / 100;

            const entryFee = entryVal * takerRate;
            const exitFee = trade.exitReason === 'tp' ? exitVal * makerRate : exitVal * takerRate;

            if (trade.exitReason === 'tp') {
                totalTakerFees += entryFee;
                totalMakerFees += exitFee;
            } else {
                totalTakerFees += entryFee + exitFee;
            }

            // Slippage & Spread
            const spreadPct = (spec.bidAskSpreadPercent / 100);
            const slipPct = (spec.baseSlippagePercent / 100);
            totalSpreadCost += (entryVal + exitVal) * (spreadPct / 2);
            totalSlippageCost += (entryVal + exitVal) * slipPct;

            // Gap losses on SL hits
            if (trade.exitReason === 'sl') {
                const gap = Math.abs(trade.exitPrice! - (trade.entryPrice * 0.98)) * tradeQty;
                totalGapLosses += Math.max(0, gap);
            }

            // Funding costs
            const holdingBars = trade.barsHeld ?? 5;
            const holdingTimeMin = holdingBars * 5; // 5m bars
            const fCost = ExecutionSimulator.calculateFundingCost(
                entryVal,
                trade.side,
                holdingTimeMin,
                spec.perpetualFundingRate8hPercent
            );
            totalFundingCost += fCost;
        }

        const totalFrictionDollars = totalMakerFees + totalTakerFees + totalSlippageCost + totalSpreadCost + totalFundingCost + totalGapLosses;
        const totalFrictionPercent = (totalFrictionDollars / initCap) * 100;

        const frictionCostBreakdown: FrictionCostBreakdown = {
            totalMakerFees: Number(totalMakerFees.toFixed(2)),
            totalTakerFees: Number(totalTakerFees.toFixed(2)),
            totalSlippageCost: Number(totalSlippageCost.toFixed(2)),
            totalSpreadCost: Number(totalSpreadCost.toFixed(2)),
            totalFundingCost: Number(totalFundingCost.toFixed(2)),
            totalGapLosses: Number(totalGapLosses.toFixed(2)),
            totalFrictionDollars: Number(totalFrictionDollars.toFixed(2)),
            totalFrictionPercent: Number(totalFrictionPercent.toFixed(2)),
        };

        // ------------------------------------------------------------
        // 4. Comparative Ratings & Degradation Metrics
        // ------------------------------------------------------------
        const idealReturn = idealResult.totalReturnPercent ?? 0;
        const realisticReturn = realisticResult.totalReturnPercent ?? 0;
        const netReturnDegradation = idealReturn - realisticReturn;

        const idealSharpe = idealResult.sharpeRatio ?? 0;
        const realisticSharpe = realisticResult.sharpeRatio ?? 0;
        const sharpeDegradation = idealSharpe - realisticSharpe;

        const idealDd = idealResult.maxDrawdownPercent ?? 0;
        const realisticDd = realisticResult.maxDrawdownPercent ?? 0;
        const ddExpansion = realisticDd - idealDd;

        const edgeRetentionRatio = idealReturn > 0
            ? Number((realisticReturn / idealReturn).toFixed(2))
            : (realisticReturn > 0 ? 1.0 : 0.0);

        let verdict: FrictionVerdict;
        let isEdgePreservedAfterFriction = false;

        if (realisticReturn > 0 && (realisticResult.profitFactor ?? 0) >= 1.25 && edgeRetentionRatio >= 0.50) {
            verdict = 'PROFITABLE_AFTER_FRICTION';
            isEdgePreservedAfterFriction = true;
        } else if (realisticReturn > 0 && edgeRetentionRatio >= 0.25) {
            verdict = 'MARGINAL_EDGE_BLEED';
            isEdgePreservedAfterFriction = true;
        } else {
            verdict = 'UNPROFITABLE_DUE_TO_FRICTION';
            isEdgePreservedAfterFriction = false;
        }

        // Qualitative Insights
        const insights: string[] = [];
        insights.push(`Ideal Net Return: ${idealReturn.toFixed(2)}% vs Realistic Net Return: ${realisticReturn.toFixed(2)}% (${netReturnDegradation.toFixed(2)}% friction degradation).`);
        insights.push(`Total exchange microstructure fees & slippage consumed $${totalFrictionDollars.toFixed(2)} (${totalFrictionPercent.toFixed(2)}% of initial capital).`);

        if (edgeRetentionRatio >= 0.65) {
            insights.push(`High edge retention (${(edgeRetentionRatio * 100).toFixed(0)}% retained). Strategy edge easily handles exchange costs.`);
        } else if (edgeRetentionRatio < 0.35 && idealReturn > 0) {
            insights.push('Significant friction decay: Over 65% of strategy profits are lost to exchange fees and slippage.');
        }

        return {
            strategyId: idealResult.strategyId,
            strategyName: idealResult.strategyName,
            exchangeName: spec.name,
            idealResult,
            realisticResult,
            frictionCostBreakdown,
            netReturnDegradationPercent: Number(netReturnDegradation.toFixed(2)),
            sharpeDegradationPercent: Number(sharpeDegradation.toFixed(2)),
            drawdownExpansionPercent: Number(ddExpansion.toFixed(2)),
            edgeRetentionRatio,
            isEdgePreservedAfterFriction,
            verdict,
            keyFrictionInsights: insights,
        };
    }
}
