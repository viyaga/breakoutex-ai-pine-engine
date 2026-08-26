// ================================================================
// BreakoutEx AI — Walk-Forward & Anti-Overfitting Engine
//
// Evaluates strategies across In-Sample (Train), Validation, and
// Out-of-Sample (Test) periods and rolling Walk-Forward Analysis (WFA)
// to detect overfitting and measure true statistical generalization.
// ================================================================

import {
    Candle,
} from '../config/types';

import {
    PineStrategyDefinition,
} from '../pine/strategy-library';

import {
    BacktestOptions,
    BacktestResult,
} from './types';

import {
    Backtester,
} from './Backtester';

import {
    normalizeTimeframe,
} from '../interpreter';

// ----------------------------------------------------------------
// Data Split Types
// ----------------------------------------------------------------

export interface SplitRatios {
    train: number; // e.g. 0.60 (60%)
    validation: number; // e.g. 0.20 (20%)
    test: number; // e.g. 0.20 (20%)
}

export interface SplitAnalysisRequest {
    strategy: PineStrategyDefinition;
    candleMap: Map<string, Candle[]>;
    ratios?: SplitRatios;
    options?: BacktestOptions;
}

export interface SplitAnalysisResult {
    strategyId: string;
    strategyName: string;
    ratios: SplitRatios;

    inSampleTrain: BacktestResult;
    validation: BacktestResult;
    outOfSampleTest: BacktestResult;

    // Overfitting & Generalization Metrics
    inSampleSharpe: number;
    outOfSampleSharpe: number;
    sharpeRetentionRatio: number; // OOS Sharpe / IS Sharpe

    inSampleReturnPercent: number;
    outOfSampleReturnPercent: number;
    returnRetentionRatio: number; // OOS Return / IS Return

    isOverfit: boolean;
    overfittingRiskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
    generalizationScore: number; // 0 - 100
}

// ----------------------------------------------------------------
// Walk-Forward Analysis Types
// ----------------------------------------------------------------

export interface WalkForwardRequest {
    strategy: PineStrategyDefinition;
    candleMap: Map<string, Candle[]>;
    windowsCount?: number; // default: 5
    inSampleRatio?: number; // default: 0.70 (70% IS, 30% OOS per window)
    anchored?: boolean; // default: false (rolling)
    options?: BacktestOptions;
}

export interface WalkForwardWindowResult {
    windowIndex: number;
    trainStartTimestamp: number;
    trainEndTimestamp: number;
    testStartTimestamp: number;
    testEndTimestamp: number;

    inSample: BacktestResult;
    outOfSample: BacktestResult;

    windowWfe: number; // Window Walk-Forward Efficiency (OOS Return / IS Return)
    isProfitableOos: boolean;
}

export interface WalkForwardAnalysisResult {
    strategyId: string;
    strategyName: string;
    windowsCount: number;
    anchored: boolean;

    windows: WalkForwardWindowResult[];

    // Aggregate Walk-Forward Metrics
    walkForwardEfficiency: number; // Mean OOS return / Mean IS return
    oosWinRatio: number; // Percentage of OOS windows that were profitable
    meanInSampleReturnPercent: number;
    meanOutOfSampleReturnPercent: number;
    meanOutOfSampleSharpe: number;
    meanOutOfSampleMaxDrawdownPercent: number;

    consistencyScore: number; // 0 - 100
    isRobust: boolean;
}

// ----------------------------------------------------------------
// WalkForwardEngine Implementation
// ----------------------------------------------------------------

export class WalkForwardEngine {

    /**
     * Run In-Sample vs Validation vs Out-of-Sample train/test split analysis.
     */
    static runSplit(
        request: SplitAnalysisRequest
    ): SplitAnalysisResult {
        const ratios: SplitRatios = request.ratios ?? {
            train: 0.60,
            validation: 0.20,
            test: 0.20,
        };

        const baseTf = normalizeTimeframe(request.options?.baseTimeframe ?? '5m');
        const baseCandles = request.candleMap.get(baseTf) ?? [];
        const targetBars = request.options?.windowBars
            ? Math.min(baseCandles.length, request.options.windowBars)
            : baseCandles.length;
        const evalStartIdx = baseCandles.length > targetBars
            ? (baseCandles.length - targetBars)
            : (baseCandles.length >= 12000 ? Math.min(Math.floor(baseCandles.length * 0.35), 9600) : 0);
        const evalCandles = baseCandles.slice(evalStartIdx);
        const totalBars = evalCandles.length;

        if (totalBars < 100) {
            throw new Error(`[INSUFFICIENT_DATA_FOR_SPLIT] Minimum 100 base candles required for split analysis, found ${totalBars}`);
        }

        const trainEndIndex = Math.floor(totalBars * ratios.train);
        const valEndIndex = Math.floor(totalBars * (ratios.train + ratios.validation));

        const trainCandles = evalCandles.slice(0, trainEndIndex);
        const valCandles = evalCandles.slice(trainEndIndex, valEndIndex);
        const testCandles = evalCandles.slice(valEndIndex);

        const trainMap = WalkForwardEngine.sliceCandleMap(request.candleMap, trainCandles);
        const valMap = WalkForwardEngine.sliceCandleMap(request.candleMap, valCandles);
        const testMap = WalkForwardEngine.sliceCandleMap(request.candleMap, testCandles);

        const baseOptions: BacktestOptions = {
            performance: {
                enabled: true,
                usePrecomputedIndicators: true,
                useCompiledScript: true,
                zeroCopySnapshots: true,
                ...request.options?.performance,
            },
            ...request.options,
        };

        const inSampleTrain = Backtester.run({
            strategy: request.strategy,
            candleMap: trainMap,
            options: { ...baseOptions, windowBars: trainCandles.length },
        });

        const validation = Backtester.run({
            strategy: request.strategy,
            candleMap: valMap,
            options: { ...baseOptions, windowBars: valCandles.length },
        });

        const outOfSampleTest = Backtester.run({
            strategy: request.strategy,
            candleMap: testMap,
            options: { ...baseOptions, windowBars: testCandles.length },
        });

        const isSharpe = inSampleTrain.sharpeRatio ?? 0;
        const oosSharpe = outOfSampleTest.sharpeRatio ?? 0;
        const sharpeRetention = isSharpe > 0 ? (oosSharpe / isSharpe) : (oosSharpe > 0 ? 1 : 0);

        const isReturn = inSampleTrain.totalReturnPercent ?? 0;
        const oosReturn = outOfSampleTest.totalReturnPercent ?? 0;
        const returnRetention = isReturn > 0 ? (oosReturn / isReturn) : (oosReturn > 0 ? 1 : 0);

        // Determine Overfitting Severity
        let riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' = 'LOW';
        let isOverfit = false;

        if (isReturn > 5 && oosReturn < -2) {
            riskLevel = 'CRITICAL';
            isOverfit = true;
        } else if (sharpeRetention < 0.35 || returnRetention < 0.30) {
            riskLevel = 'HIGH';
            isOverfit = true;
        } else if (sharpeRetention < 0.60 || returnRetention < 0.55) {
            riskLevel = 'MODERATE';
        }

        // Generalization Score (0 - 100)
        let score = 50;
        if (oosReturn > 0) score += 20;
        if (sharpeRetention >= 0.70) score += 20;
        else if (sharpeRetention >= 0.50) score += 10;
        else score -= 15;

        if (outOfSampleTest.winRate >= 45) score += 10;
        if (riskLevel === 'CRITICAL') score = Math.min(score, 20);

        const generalizationScore = Math.max(0, Math.min(100, Math.round(score)));

        return {
            strategyId: request.strategy.id,
            strategyName: request.strategy.name,
            ratios,
            inSampleTrain,
            validation,
            outOfSampleTest,
            inSampleSharpe: Number(isSharpe.toFixed(2)),
            outOfSampleSharpe: Number(oosSharpe.toFixed(2)),
            sharpeRetentionRatio: Number(sharpeRetention.toFixed(2)),
            inSampleReturnPercent: Number(isReturn.toFixed(2)),
            outOfSampleReturnPercent: Number(oosReturn.toFixed(2)),
            returnRetentionRatio: Number(returnRetention.toFixed(2)),
            isOverfit,
            overfittingRiskLevel: riskLevel,
            generalizationScore,
        };
    }

    /**
     * Run multi-window Walk-Forward Analysis (WFA).
     */
    static runWalkForward(
        request: WalkForwardRequest
    ): WalkForwardAnalysisResult {
        const windowsCount = request.windowsCount ?? 5;
        const isRatio = request.inSampleRatio ?? 0.70;
        const anchored = request.anchored ?? false;

        const baseTf = normalizeTimeframe(request.options?.baseTimeframe ?? '5m');
        const baseCandles = request.candleMap.get(baseTf) ?? [];
        const targetBars = request.options?.windowBars
            ? Math.min(baseCandles.length, request.options.windowBars)
            : baseCandles.length;
        const evalStartIdx = baseCandles.length > targetBars
            ? (baseCandles.length - targetBars)
            : (baseCandles.length >= 12000 ? Math.min(Math.floor(baseCandles.length * 0.35), 9600) : 0);
        const evalCandles = baseCandles.slice(evalStartIdx);
        const totalBars = evalCandles.length;

        if (totalBars < 200) {
            throw new Error(`[INSUFFICIENT_DATA_FOR_WFA] Minimum 200 base candles required for Walk-Forward Analysis, found ${totalBars}`);
        }

        // Divide dataset into windows
        const stepSize = Math.floor(totalBars / (windowsCount + 1));
        const windowSize = Math.floor(totalBars * 0.5); // 50% window size for rolling

        const windows: WalkForwardWindowResult[] = [];
        let profitableOosCount = 0;
        let sumWfe = 0;
        let sumOosReturn = 0;
        let sumIsReturn = 0;
        let sumOosSharpe = 0;
        let sumOosDrawdown = 0;

        const baseOptions: BacktestOptions = {
            performance: {
                enabled: true,
                usePrecomputedIndicators: true,
                useCompiledScript: true,
                zeroCopySnapshots: true,
                ...request.options?.performance,
            },
            ...request.options,
        };

        for (let w = 0; w < windowsCount; w++) {
            const startIdx = anchored ? 0 : w * stepSize;
            const endIdx = Math.min(totalBars, startIdx + windowSize);
            const windowCandles = evalCandles.slice(startIdx, endIdx);

            if (windowCandles.length < 50) continue;

            const splitIdx = Math.floor(windowCandles.length * isRatio);
            const isCandles = windowCandles.slice(0, splitIdx);
            const oosCandles = windowCandles.slice(splitIdx);

            const isMap = WalkForwardEngine.sliceCandleMap(request.candleMap, isCandles);
            const oosMap = WalkForwardEngine.sliceCandleMap(request.candleMap, oosCandles);

            const inSample = Backtester.run({
                strategy: request.strategy,
                candleMap: isMap,
                options: { ...baseOptions, windowBars: isCandles.length },
            });

            const outOfSample = Backtester.run({
                strategy: request.strategy,
                candleMap: oosMap,
                options: { ...baseOptions, windowBars: oosCandles.length },
            });

            const isRet = inSample.totalReturnPercent ?? 0;
            const oosRet = outOfSample.totalReturnPercent ?? 0;
            const windowWfe = isRet > 0 ? (oosRet / isRet) : (oosRet > 0 ? 1 : 0);
            const isProfitableOos = oosRet > 0;

            if (isProfitableOos) profitableOosCount++;
            sumWfe += windowWfe;
            sumOosReturn += oosRet;
            sumIsReturn += isRet;
            sumOosSharpe += outOfSample.sharpeRatio ?? 0;
            sumOosDrawdown += outOfSample.maxDrawdownPercent ?? 0;

            windows.push({
                windowIndex: w + 1,
                trainStartTimestamp: isCandles[0].timestamp,
                trainEndTimestamp: isCandles[isCandles.length - 1].timestamp,
                testStartTimestamp: oosCandles[0].timestamp,
                testEndTimestamp: oosCandles[oosCandles.length - 1].timestamp,
                inSample,
                outOfSample,
                windowWfe: Number(windowWfe.toFixed(2)),
                isProfitableOos,
            });
        }

        const validWindows = windows.length;
        const oosWinRatio = validWindows > 0 ? (profitableOosCount / validWindows) * 100 : 0;
        const walkForwardEfficiency = validWindows > 0 ? (sumWfe / validWindows) : 0;
        const meanOosReturn = validWindows > 0 ? (sumOosReturn / validWindows) : 0;
        const meanIsReturn = validWindows > 0 ? (sumIsReturn / validWindows) : 0;
        const meanOosSharpe = validWindows > 0 ? (sumOosSharpe / validWindows) : 0;
        const meanOosMaxDrawdown = validWindows > 0 ? (sumOosDrawdown / validWindows) : 0;

        // Consistency Score Calculation (0 - 100)
        let score = 40;
        if (oosWinRatio >= 80) score += 30;
        else if (oosWinRatio >= 60) score += 20;
        else if (oosWinRatio < 40) score -= 20;

        if (walkForwardEfficiency >= 0.70) score += 20;
        else if (walkForwardEfficiency >= 0.50) score += 10;
        else if (walkForwardEfficiency < 0.30) score -= 15;

        if (meanOosSharpe > 1.0) score += 10;

        const consistencyScore = Math.max(0, Math.min(100, Math.round(score)));
        const isRobust = oosWinRatio >= 60 && walkForwardEfficiency >= 0.50;

        return {
            strategyId: request.strategy.id,
            strategyName: request.strategy.name,
            windowsCount: validWindows,
            anchored,
            windows,
            walkForwardEfficiency: Number(walkForwardEfficiency.toFixed(2)),
            oosWinRatio: Number(oosWinRatio.toFixed(2)),
            meanInSampleReturnPercent: Number(meanIsReturn.toFixed(2)),
            meanOutOfSampleReturnPercent: Number(meanOosReturn.toFixed(2)),
            meanOutOfSampleSharpe: Number(meanOosSharpe.toFixed(2)),
            meanOutOfSampleMaxDrawdownPercent: Number(meanOosMaxDrawdown.toFixed(2)),
            consistencyScore,
            isRobust,
        };
    }

    // ------------------------------------------------------------
    // Slice CandleMap for sub-windows
    // ------------------------------------------------------------

    private static sliceCandleMap(
        candleMap: Map<string, Candle[]>,
        targetBaseCandles: Candle[]
    ): Map<string, Candle[]> {
        if (targetBaseCandles.length === 0) return new Map();

        const endTs = targetBaseCandles[targetBaseCandles.length - 1].timestamp;

        const resultMap = new Map<string, Candle[]>();

        for (const [tf, candles] of candleMap.entries()) {
            const sliced = candles.filter(c => c.timestamp <= endTs);
            resultMap.set(tf, sliced.length > 0 ? sliced : candles.slice(0, 1));
        }

        return resultMap;
    }
}
