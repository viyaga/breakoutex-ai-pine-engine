// ================================================================
// BreakoutEx AI — Level 2 Meta-Strategy Out-of-Sample Validator
//
// Validates the strategy selection and portfolio construction mechanism itself
// on untouched forward test data to prevent overfitting in the AI meta-selector.
// ================================================================

import { Candle } from '../config/types';
import { PineStrategyDefinition } from '../pine/strategy-library';
import { BacktestOptions, BacktestResult } from './types';
import { Backtester } from './Backtester';
import { AIRobustnessScorer } from './AIRobustnessScorer';
import { PortfolioOptimizer, PortfolioAllocationReport, AllocationModel } from './PortfolioOptimizer';
import { StrategyCorrelationEngine } from './StrategyCorrelationEngine';
import { normalizeTimeframe } from '../interpreter';

export interface MetaStrategyValidationRequest {
    strategies: PineStrategyDefinition[];
    candleMap: Map<string, Candle[]>;
    selectionRatio?: number; // e.g. 0.70 (70% Selection Phase T1, 30% Realization Phase T2)
    maxSelectedStrategies?: number; // default: 3
    allocationModel?: AllocationModel;
    options?: BacktestOptions;
}

export interface MetaStrategyValidationReport {
    selectionPhaseBars: number;
    realizationPhaseBars: number;
    selectedStrategiesCount: number;

    // Selected Portfolio Definition (decided purely on T1)
    selectedPortfolioAllocations: Array<{
        strategyId: string;
        strategyName: string;
        weightPercent: number;
        inSampleRank: number;
        inSampleDeploymentScore: number;
    }>;

    // In-Sample (T1) Performance
    inSamplePredictedReturnPercent: number;
    inSamplePredictedSharpe: number;
    inSamplePredictedMaxDrawdownPercent: number;

    // Realized Out-of-Sample (T2) Performance
    realizedOutOfSampleReturnPercent: number;
    realizedOutOfSampleSharpe: number;
    realizedOutOfSampleMaxDrawdownPercent: number;

    // Benchmarks on Untouched T2 Data
    singleBestStrategyOosReturnPercent: number;
    singleBestStrategyOosSharpe: number;
    equalWeightBenchmarkOosReturnPercent: number;
    equalWeightBenchmarkOosSharpe: number;

    // Meta-Strategy Generalization Metrics
    metaSelectionEfficiency: number; // Realized OOS Sharpe / Predicted IS Sharpe
    excessSharpeVsSingleStrategy: number;
    excessSharpeVsEqualWeight: number;
    isMetaStrategyRobust: boolean;
    metaGeneralizationRating: 'EXCELLENT' | 'ROBUST' | 'ACCEPTABLE' | 'DEGRADED';
}

export class MetaStrategyValidator {

    /**
     * Run full Level-2 out-of-sample validation on the AI strategy selector.
     */
    static validate(
        request: MetaStrategyValidationRequest
    ): MetaStrategyValidationReport {
        const selectionRatio = request.selectionRatio ?? 0.70;
        const maxSelected = request.maxSelectedStrategies ?? 3;
        const allocModel = request.allocationModel ?? 'CLUSTER_BALANCED';
        const strategies = request.strategies;

        const baseTf = normalizeTimeframe(request.options?.baseTimeframe ?? '5m');
        const baseCandles = request.candleMap.get(baseTf) ?? [];
        const totalBars = baseCandles.length;

        if (totalBars < 300) {
            throw new Error(`[INSUFFICIENT_DATA_FOR_META_VALIDATION] Minimum 300 base candles required, found ${totalBars}`);
        }

        const t1EndIndex = Math.floor(totalBars * selectionRatio);
        const t1Candles = baseCandles.slice(0, t1EndIndex);
        const t2Candles = baseCandles.slice(t1EndIndex);

        const t1EndTs = t1Candles[t1Candles.length - 1].timestamp;
        const t2EndTs = t2Candles[t2Candles.length - 1].timestamp;

        // Slice data for T1 (Selection Phase) and T2 (Realization Phase)
        // Preserving full historical prefix before endTs for zero-lookahead indicator warmup
        const t1Map = new Map<string, Candle[]>();
        const t2Map = new Map<string, Candle[]>();

        for (const [tf, candles] of request.candleMap.entries()) {
            const t1Sliced = candles.filter(c => c.timestamp <= t1EndTs);
            const t2Sliced = candles.filter(c => c.timestamp <= t2EndTs);
            t1Map.set(tf, t1Sliced.length > 0 ? t1Sliced : candles);
            t2Map.set(tf, t2Sliced.length > 0 ? t2Sliced : candles);
        }

        const basePerfOptions: BacktestOptions = {
            performance: {
                enabled: true,
                usePrecomputedIndicators: true,
                useCompiledScript: true,
                zeroCopySnapshots: true,
            },
            ...request.options,
        };

        // ------------------------------------------------------------
        // STEP 1: Run Strategy Selection & Portfolio Optimization on T1
        // ------------------------------------------------------------
        const t1Reports = strategies.map(strategy =>
            AIRobustnessScorer.evaluate(strategy, t1Map, {
                ...basePerfOptions,
                windowBars: Math.min(t1Candles.length, t1Map.get(baseTf)?.length ?? t1Candles.length),
            })
        );

        // Sort by deploymentScore descending on T1
        t1Reports.sort((a, b) => b.deploymentScore - a.deploymentScore);

        const t1BacktestResults = t1Reports.map(r => r.fullBacktest);
        const t1Correlation = StrategyCorrelationEngine.analyze(t1BacktestResults);

        // Select top non-redundant strategies on T1
        const chosenT1Reports = [];
        const chosenIndices = [];

        for (let i = 0; i < t1Reports.length; i++) {
            if (chosenT1Reports.length >= maxSelected) break;
            let redundant = false;
            for (const cIdx of chosenIndices) {
                if (t1Correlation.correlationMatrix[i]?.[cIdx] > 0.65) {
                    redundant = true;
                    break;
                }
            }
            if (!redundant || chosenT1Reports.length === 0) {
                chosenT1Reports.push(t1Reports[i]);
                chosenIndices.push(i);
            }
        }

        const clusterMap = new Map<string, string>();
        for (const cl of t1Correlation.clusters) {
            for (const sId of cl.strategyIds) clusterMap.set(sId, cl.clusterId);
        }

        // Optimize portfolio weights on T1
        const t1AllocationInput = chosenT1Reports.map(r => ({
            strategyId: r.strategyId,
            strategyName: r.strategyName,
            result: r.fullBacktest,
            deploymentScore: r.deploymentScore,
            clusterId: clusterMap.get(r.strategyId),
        }));

        const isPortfolioReport = PortfolioOptimizer.optimize(
            t1AllocationInput,
            t1Correlation,
            { model: allocModel, totalCapital: 10000, cashReservePercent: 10 }
        );

        // ------------------------------------------------------------
        // STEP 2: Evaluate the Chosen Portfolio on Untouched Forward T2
        // ------------------------------------------------------------
        const t2ChosenResults: BacktestResult[] = [];

        for (const chosen of chosenT1Reports) {
            const stratDef = strategies.find(s => s.id === chosen.strategyId)!;
            const resT2 = Backtester.run({
                strategy: stratDef,
                candleMap: t2Map,
                options: {
                    ...basePerfOptions,
                    windowBars: t2Candles.length,
                },
            });
            t2ChosenResults.push(resT2);
        }

        const t2AllocationInput = chosenT1Reports.map((r, idx) => ({
            strategyId: r.strategyId,
            strategyName: r.strategyName,
            result: t2ChosenResults[idx],
            deploymentScore: r.deploymentScore,
            clusterId: clusterMap.get(r.strategyId),
        }));

        // Apply EXACT fixed weights from T1 onto T2 forward data
        const oosPortfolioReport = PortfolioOptimizer.optimize(
            t2AllocationInput,
            undefined,
            { model: allocModel, totalCapital: 10000, cashReservePercent: isPortfolioReport.cashReservePercent }
        );

        // ------------------------------------------------------------
        // STEP 3: Benchmark Against Single #1 Strategy & Equal Weight
        // ------------------------------------------------------------
        const singleBestStratDef = strategies.find(s => s.id === t1Reports[0].strategyId)!;
        const singleBestT2Result = Backtester.run({
            strategy: singleBestStratDef,
            candleMap: t2Map,
            options: { ...basePerfOptions, windowBars: t2Candles.length },
        });

        // Equal weight portfolio on T2
        const eqWeightPortfolioReport = PortfolioOptimizer.optimize(
            t2AllocationInput,
            undefined,
            { model: 'EQUAL_WEIGHT', totalCapital: 10000, cashReservePercent: 10 }
        );

        // ------------------------------------------------------------
        // STEP 4: Calculate Meta-Selection Generalization Metrics
        // ------------------------------------------------------------
        const isSharpe = isPortfolioReport.portfolioSharpe;
        const oosSharpe = oosPortfolioReport.portfolioSharpe;
        const mse = isSharpe > 0 ? (oosSharpe / isSharpe) : (oosSharpe > 0 ? 1 : 0);

        const singleOosSharpe = singleBestT2Result.sharpeRatio ?? 0;
        const eqOosSharpe = eqWeightPortfolioReport.portfolioSharpe;

        const excessSharpeVsSingle = Number((oosSharpe - singleOosSharpe).toFixed(2));
        const excessSharpeVsEq = Number((oosSharpe - eqOosSharpe).toFixed(2));

        let rating: MetaStrategyValidationReport['metaGeneralizationRating'] = 'ACCEPTABLE';
        if (mse >= 0.70 && oosSharpe > singleOosSharpe) {
            rating = 'EXCELLENT';
        } else if (mse >= 0.50) {
            rating = 'ROBUST';
        } else if (mse < 0.25 || oosPortfolioReport.portfolioReturnPercent < 0) {
            rating = 'DEGRADED';
        }

        const isRobust = mse >= 0.40 && oosPortfolioReport.portfolioReturnPercent >= 0;

        return {
            selectionPhaseBars: t1Candles.length,
            realizationPhaseBars: t2Candles.length,
            selectedStrategiesCount: chosenT1Reports.length,
            selectedPortfolioAllocations: isPortfolioReport.strategyAllocations.map((a, idx) => ({
                strategyId: a.strategyId,
                strategyName: a.strategyName,
                weightPercent: a.weightPercent,
                inSampleRank: idx + 1,
                inSampleDeploymentScore: a.deploymentScore,
            })),
            inSamplePredictedReturnPercent: isPortfolioReport.portfolioReturnPercent,
            inSamplePredictedSharpe: isSharpe,
            inSamplePredictedMaxDrawdownPercent: isPortfolioReport.portfolioMaxDrawdownPercent,
            realizedOutOfSampleReturnPercent: oosPortfolioReport.portfolioReturnPercent,
            realizedOutOfSampleSharpe: oosSharpe,
            realizedOutOfSampleMaxDrawdownPercent: oosPortfolioReport.portfolioMaxDrawdownPercent,
            singleBestStrategyOosReturnPercent: singleBestT2Result.totalReturnPercent ?? 0,
            singleBestStrategyOosSharpe: singleOosSharpe,
            equalWeightBenchmarkOosReturnPercent: eqWeightPortfolioReport.portfolioReturnPercent,
            equalWeightBenchmarkOosSharpe: eqOosSharpe,
            metaSelectionEfficiency: Number(mse.toFixed(2)),
            excessSharpeVsSingleStrategy: excessSharpeVsSingle,
            excessSharpeVsEqualWeight: excessSharpeVsEq,
            isMetaStrategyRobust: isRobust,
            metaGeneralizationRating: rating,
        };
    }
}
