// ================================================================
// BreakoutEx AI — Automated Stress Test & Resilience Suite
//
// Evaluates trading strategies against extreme market stress conditions
// (Flash Crash, Flash Pump, Volatility Explosion, Liquidity Collapse, Gaps,
// and Data Corruption) to compute a final Stress Resilience Verdict.
// ================================================================

import { Candle } from '../config/types';
import { PineStrategyDefinition } from '../pine/strategy-library';
import { BacktestOptions, BacktestResult } from './types';
import { Backtester } from './Backtester';
import { HistoricalDataValidator, DataQualityReport } from './HistoricalDataValidator';
import { MarketStressGenerator, StressScenarioType } from './MarketStressGenerator';
import { normalizeTimeframe } from '../interpreter';

export type StressVerdict = 'ROBUST' | 'DEGRADED' | 'FRAGILE' | 'FAILED';

export interface StressScenarioResult {
    scenario: StressScenarioType;
    scenarioName: string;
    returnPercent: number;
    maxDrawdownPercent: number;
    totalTrades: number;
    survived: boolean; // Did not liquidate or crash engine
    performanceRetentionRatio: number; // Scenario Return / Baseline Return
}

export interface StressTestReport {
    strategyId: string;
    strategyName: string;

    // Baseline & Data Quality
    baselineResult: BacktestResult;
    dataQualityReport: DataQualityReport;

    // Scenario Results
    scenarioResults: StressScenarioResult[];

    // Overall Resilience Metrics
    worstScenarioName: string;
    maxStressDrawdownPercent: number;
    avgStressReturnPercent: number;
    stressResilienceScore: number; // 0 - 100 score
    verdict: StressVerdict;
    recommendations: string[];
}

export interface StressTestRequest {
    strategy: PineStrategyDefinition | string;
    candleMap: Map<string, Candle[]> | Record<string, Candle[]>;
    options?: BacktestOptions;
    timeframe?: string;
    customScenarios?: StressScenarioType[];
}

import { STRATEGY_LIBRARY } from '../pine/strategy-library';

export class StressTestRunner {

    /**
     * Run a comprehensive stress test evaluation across all market disruption scenarios.
     */
    static run(request: StressTestRequest): StressTestReport {
        const baseTf = normalizeTimeframe(request.timeframe ?? request.options?.baseTimeframe ?? '5m');

        // Resolve Candle Map
        let candleMap: Map<string, Candle[]>;
        if (request.candleMap instanceof Map) {
            candleMap = request.candleMap;
        } else {
            candleMap = new Map<string, Candle[]>();
            for (const [tf, candles] of Object.entries(request.candleMap)) {
                candleMap.set(normalizeTimeframe(tf), candles);
            }
        }

        const baseCandles = candleMap.get(baseTf) ?? [];

        // 1. Historical Data Quality Inspection & Repair
        const dataQualityReport = HistoricalDataValidator.validate(baseCandles, {
            mode: 'REPAIR',
            intervalMinutes: baseTf === '1h' ? 60 : (baseTf === '15m' ? 15 : 5),
        });

        // Use repaired candles if dataset had anomalies
        if (dataQualityReport.repairedCandles) {
            candleMap.set(baseTf, dataQualityReport.repairedCandles);
        }

        const strategyDef = typeof request.strategy === 'string'
            ? STRATEGY_LIBRARY[request.strategy] || STRATEGY_LIBRARY.mtf_trend_continuation
            : request.strategy;

        const options = request.options ?? {};

        // 2. Baseline Run (Clean Data)
        const baselineResult = Backtester.run({
            strategy: strategyDef,
            candleMap,
            options,
        });

        const baselineReturn = baselineResult.totalReturnPercent ?? 0;
        const baselineDd = baselineResult.maxDrawdownPercent ?? 0;

        // 3. Stress Scenarios Execution
        const targetScenarios: StressScenarioType[] = request.customScenarios ?? [
            'FLASH_CRASH',
            'FLASH_PUMP',
            'VOLATILITY_EXPLOSION',
            'LIQUIDITY_COLLAPSE',
            'GAP_DOWN',
            'DATA_CORRUPTION',
        ];

        const scenarioResults: StressScenarioResult[] = [];
        let maxStressDrawdown = baselineDd;
        let worstScenarioName = 'Baseline';
        let totalStressReturn = 0;
        let failedScenarioCount = 0;

        for (const scenarioType of targetScenarios) {
            try {
                // Generate stressed candle map
                const stressedBaseCandles = MarketStressGenerator.injectStressScenario(baseCandles, scenarioType);

                // Auto-repair if scenario is DATA_CORRUPTION
                let runCandles = stressedBaseCandles;
                if (scenarioType === 'DATA_CORRUPTION') {
                    const repaired = HistoricalDataValidator.validate(stressedBaseCandles, { mode: 'REPAIR' });
                    if (repaired.repairedCandles) runCandles = repaired.repairedCandles;
                }

                const stressedCandleMap = new Map<string, Candle[]>(candleMap);
                stressedCandleMap.set(baseTf, runCandles);

                const res = Backtester.run({
                    strategy: strategyDef,
                    candleMap: stressedCandleMap,
                    options,
                });

                const retPct = res.totalReturnPercent ?? 0;
                const ddPct = res.maxDrawdownPercent ?? 0;
                const survived = (res.finalCapital > 0) && (ddPct < 90);

                if (!survived) failedScenarioCount++;

                if (ddPct > maxStressDrawdown) {
                    maxStressDrawdown = ddPct;
                    worstScenarioName = scenarioType;
                }

                totalStressReturn += retPct;

                const retentionRatio = baselineReturn !== 0
                    ? Number((retPct / baselineReturn).toFixed(2))
                    : (retPct >= 0 ? 1.0 : 0.0);

                scenarioResults.push({
                    scenario: scenarioType,
                    scenarioName: scenarioType.replace('_', ' '),
                    returnPercent: Number(retPct.toFixed(2)),
                    maxDrawdownPercent: Number(ddPct.toFixed(2)),
                    totalTrades: res.totalTrades,
                    survived,
                    performanceRetentionRatio: retentionRatio,
                });
            } catch (err) {
                failedScenarioCount++;
                scenarioResults.push({
                    scenario: scenarioType,
                    scenarioName: scenarioType.replace('_', ' '),
                    returnPercent: -100,
                    maxDrawdownPercent: 100,
                    totalTrades: 0,
                    survived: false,
                    performanceRetentionRatio: 0,
                });
            }
        }

        // 4. Resilience Score & Verdict Calculation
        const avgStressReturn = Number((totalStressReturn / Math.max(1, targetScenarios.length)).toFixed(2));
        const ddPenalty = Math.min(50, maxStressDrawdown * 0.8);
        const failurePenalty = failedScenarioCount * 25;
        const qualityPenalty = Math.max(0, (100 - dataQualityReport.qualityScore) * 0.2);

        const resilienceScore = Math.max(0, Math.min(100, Math.round(100 - ddPenalty - failurePenalty - qualityPenalty)));

        let verdict: StressVerdict;
        if (failedScenarioCount === 0 && resilienceScore >= 75 && maxStressDrawdown <= 25) {
            verdict = 'ROBUST';
        } else if (failedScenarioCount === 0 && resilienceScore >= 55) {
            verdict = 'DEGRADED';
        } else if (failedScenarioCount <= 1 && resilienceScore >= 35) {
            verdict = 'FRAGILE';
        } else {
            verdict = 'FAILED';
        }

        const recommendations: string[] = [];
        recommendations.push(`Data Quality Score: ${dataQualityReport.qualityScore}/100 (${dataQualityReport.issues.length} data issues detected).`);
        recommendations.push(`Worst Stress Scenario: ${worstScenarioName} (Max Drawdown: ${maxStressDrawdown.toFixed(2)}%).`);

        if (verdict === 'ROBUST') {
            recommendations.push('Strategy demonstrates high structural resilience across extreme crashes and volatility shocks.');
        } else if (verdict === 'FRAGILE' || verdict === 'FAILED') {
            recommendations.push('High vulnerability to market gaps and volatility explosions. Consider tightening stop-loss limits.');
        }

        return {
            strategyId: baselineResult.strategyId,
            strategyName: baselineResult.strategyName,
            baselineResult,
            dataQualityReport,
            scenarioResults,
            worstScenarioName,
            maxStressDrawdownPercent: Number(maxStressDrawdown.toFixed(2)),
            avgStressReturnPercent: avgStressReturn,
            stressResilienceScore: resilienceScore,
            verdict,
            recommendations,
        };
    }
}
