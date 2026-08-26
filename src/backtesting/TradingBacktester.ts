// ================================================================
// BreakoutEx AI — Unified Reusable Backtesting API
//
// Single clean public entrypoint for all backtesting operations.
// Encapsulates internal subsystems:
// - BacktestContext & MTFSeriesCache
// - IndicatorEngine & SeriesCache
// - TimeframeCursor & DataFeed
// - PineScriptCompiler & Interpreter
// - OrderExecution & MetricsEngine
// ================================================================

import {
    Candle,
} from '../config/types';

import {
    BacktestOptions,
    BacktestRequest,
    BacktestResult,
} from './types';

import {
    Backtester,
} from './Backtester';

import {
    PineStrategyDefinition,
    STRATEGY_LIBRARY,
    getAllStrategies,
} from '../pine/strategy-library';

import {
    PerformanceTimer,
} from './PerformanceTimer';

import {
    normalizeTimeframe,
} from '../pine/interpreter';

import {
    AIRobustnessScorer,
    ComprehensiveRobustnessReport,
    RobustnessVerdict,
    DeploymentWeightOptions,
} from './AIRobustnessScorer';

import {
    WalkForwardEngine,
    WalkForwardRequest,
    WalkForwardAnalysisResult,
    SplitAnalysisRequest,
    SplitAnalysisResult,
} from './WalkForwardEngine';

import {
    MarketRegimeClassifier,
    MarketRegime,
    CurrentMarketRegimeReport,
    RegimeAnalysisResult,
} from './MarketRegimeClassifier';

import {
    StrategyCorrelationEngine,
    StrategyCorrelationReport,
    StrategyPairCorrelation,
    StrategyCluster,
} from './StrategyCorrelationEngine';

import {
    MonteCarloSimulator,
    MonteCarloOptions,
    MonteCarloSimulationResult,
} from './MonteCarloSimulator';

import {
    BacktestTrade,
} from './types';

import {
    StatisticalCalibrator,
    StatisticalCalibrationReport,
    ConfidenceInterval,
} from './StatisticalCalibrator';

import {
    PortfolioOptimizer,
    PortfolioAllocationReport,
    AllocationModel,
    PortfolioOptimizationOptions,
} from './PortfolioOptimizer';

import {
    MetaStrategyValidator,
    MetaStrategyValidationRequest,
    MetaStrategyValidationReport,
} from './MetaStrategyValidator';

import {
    RiskExecutionGate,
    RiskGateConfig,
    TradeEvaluationRequest,
    RiskGateDecision,
    RiskStatus,
} from './RiskExecutionGate';

import {
    ExchangeConfig,
    ExchangeContractSpec,
    PRESET_EXCHANGES,
} from './ExchangeConfig';

import {
    ExecutionSimulator,
    FillRequest,
    ExecutionFillResult,
    OrderType,
} from './ExecutionSimulator';

import {
    ExecutionComparisonEngine,
    ExecutionComparisonRequest,
    ExecutionComparisonReport,
    FrictionCostBreakdown,
    FrictionVerdict,
} from './ExecutionComparison';

import {
    HistoricalDataValidator,
    DataQualityReport,
    ValidationOptions,
    DataQualityIssue,
} from './HistoricalDataValidator';

import {
    MarketStressGenerator,
    StressScenarioType,
} from './MarketStressGenerator';

import {
    StressTestRunner,
    StressTestRequest,
    StressTestReport,
    StressVerdict,
} from './StressTestRunner';

export type {
    ExchangeContractSpec,
    FillRequest,
    ExecutionFillResult,
    OrderType,
    ExecutionComparisonRequest,
    ExecutionComparisonReport,
    FrictionCostBreakdown,
    FrictionVerdict,
    DataQualityReport,
    ValidationOptions,
    DataQualityIssue,
    StressScenarioType,
    StressTestRequest,
    StressTestReport,
    StressVerdict,
};

export interface PortfolioConstructionRequest extends BatchBacktestRequest {
    allocationModel?: AllocationModel;
    totalCapital?: number;
    cashReservePercent?: number;
    maxWeightPerStrategyPercent?: number;
    maxClusterExposurePercent?: number;
    deploymentWeights?: DeploymentWeightOptions;
}

export interface LiveStrategySelectionReport {
    timestamp: number;
    currentRegime: MarketRegime;
    regimeConfidence: number;
    recommendedCharacteristics: string[];
    selectedStrategies: Array<{
        strategyId: string;
        strategyName: string;
        rank: number;
        deploymentScore: number;
        historicalRobustnessScore: number;
        currentRegimeFitScore: number;
        recommendation: string;
        clusterId?: string;
    }>;
    correlationAnalysis: StrategyCorrelationReport;
    portfolioDiversificationScore: number;
}

// ----------------------------------------------------------------
// Public Request Types
// ----------------------------------------------------------------

export interface TradingBacktestRequest {
    /**
     * Strategy definition or strategy ID from the strategy library
     * (e.g. 'mtf_trend_continuation', 'mtf_supertrend_vwap').
     */
    strategy: PineStrategyDefinition | string;

    /**
     * Multi-timeframe historical candle map or record.
     * Key = timeframe string ('5m', '15m', '1h', '4h', '1d').
     */
    candleMap?: Map<string, Candle[]> | Record<string, Candle[]>;

    /**
     * Single timeframe candles array (shorthand for single-timeframe strategies).
     */
    candles?: Candle[];

    /**
     * Trading symbol (e.g. 'BTCUSDT', 'ETHUSDT').
     */
    symbol?: string;

    /**
     * Base trading timeframe (default: '5m').
     */
    timeframe?: string;

    /**
     * Backtest simulation options (capital, fees, warmup, slippage).
     */
    options?: BacktestOptions;
}

export interface PineScriptBacktestRequest {
    /**
     * Raw Pine Script source code.
     */
    pineScript: string;

    /**
     * Optional identifier for the strategy.
     */
    strategyId?: string;

    /**
     * Optional display name for the strategy.
     */
    strategyName?: string;

    /**
     * Multi-timeframe historical candle map or record.
     */
    candleMap?: Map<string, Candle[]> | Record<string, Candle[]>;

    /**
     * Single timeframe candles array.
     */
    candles?: Candle[];

    /**
     * Trading symbol.
     */
    symbol?: string;

    /**
     * Base trading timeframe (default: '5m').
     */
    timeframe?: string;

    /**
     * Backtest simulation options.
     */
    options?: BacktestOptions;
}

export interface BatchBacktestRequest {
    /**
     * List of strategies (definitions or IDs).
     */
    strategies?: (PineStrategyDefinition | string)[];

    /**
     * Multi-timeframe historical candle map or record.
     */
    candleMap: Map<string, Candle[]> | Record<string, Candle[]>;

    /**
     * Trading symbol.
     */
    symbol?: string;

    /**
     * Base trading timeframe (default: '5m').
     */
    timeframe?: string;

    /**
     * Shared backtest options.
     */
    options?: BacktestOptions;
}

export interface BenchmarkStrategyStats {
    strategyId: string;
    strategyName: string;
    executionTimeMs: number;
    barsPerSecond: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    netProfit: number;
    netProfitPercent: number;
    maxDrawdownPercent: number;
    profitFactor: number;
}

export interface BenchmarkReport {
    totalStrategies: number;
    totalBars: number;
    totalTimeMs: number;
    averageTimePerStrategyMs: number;
    overallBarsPerSecond: number;
    heapMemoryDeltaMb: number;
    currentHeapMb: number;
    strategyBreakdown: BenchmarkStrategyStats[];
}

// ----------------------------------------------------------------
// TradingBacktester Class
// ----------------------------------------------------------------

export class TradingBacktester {

    /**
     * Run a single backtest synchronously or asynchronously.
     */
    static run(
        request: TradingBacktestRequest
    ): BacktestResult {
        const strategyDef = TradingBacktester.resolveStrategy(request.strategy);
        const candleMap = TradingBacktester.resolveCandleMap(
            request.candleMap,
            request.candles,
            request.timeframe ?? request.options?.baseTimeframe ?? '5m'
        );

        const options: BacktestOptions = {
            baseTimeframe: request.timeframe ?? request.options?.baseTimeframe ?? '5m',
            symbol: request.symbol ?? request.options?.symbol ?? 'BTCUSDT',
            ...request.options,
        };

        return Backtester.run({
            strategy: strategyDef,
            candleMap,
            options,
        });
    }

    /**
     * Async convenience wrapper for run().
     */
    static async runAsync(
        request: TradingBacktestRequest
    ): Promise<BacktestResult> {
        return TradingBacktester.run(request);
    }

    /**
     * Run a raw Pine Script backtest directly.
     */
    static runPine(
        request: PineScriptBacktestRequest
    ): BacktestResult {
        const strategyDef: PineStrategyDefinition = {
            id: request.strategyId ?? 'custom_pine_script',
            name: request.strategyName ?? 'Custom Pine Script',
            description: 'Dynamically evaluated Pine Script strategy',
            bestMarketConditions: ['trending_bullish', 'trending_bearish', 'high_volatility_breakout'],
            recommendedTimeframe: request.timeframe ?? '5m',
            defaultTpPercent: request.options?.defaultTpPercent ?? 3.0,
            defaultSlPercent: request.options?.defaultSlPercent ?? 1.5,
            pineScript: request.pineScript,
        };

        return TradingBacktester.run({
            strategy: strategyDef,
            candleMap: request.candleMap,
            candles: request.candles,
            symbol: request.symbol,
            timeframe: request.timeframe,
            options: request.options,
        });
    }

    /**
     * Async convenience wrapper for runPine().
     */
    static async runPineAsync(
        request: PineScriptBacktestRequest
    ): Promise<BacktestResult> {
        return TradingBacktester.runPine(request);
    }

    /**
     * Run multiple strategies in batch using shared precomputed MTF context.
     */
    static runMany(
        request: BatchBacktestRequest
    ): BacktestResult[] {
        const strategies = (request.strategies && request.strategies.length > 0)
            ? request.strategies.map(s => TradingBacktester.resolveStrategy(s))
            : getAllStrategies();

        const candleMap = TradingBacktester.resolveCandleMap(
            request.candleMap,
            undefined,
            request.timeframe ?? request.options?.baseTimeframe ?? '5m'
        );

        const options: BacktestOptions = {
            baseTimeframe: request.timeframe ?? request.options?.baseTimeframe ?? '5m',
            symbol: request.symbol ?? request.options?.symbol ?? 'BTCUSDT',
            ...request.options,
        };

        return Backtester.runMany(
            strategies,
            candleMap,
            options
        );
    }

    /**
     * Async convenience wrapper for runMany().
     */
    static async runManyAsync(
        request: BatchBacktestRequest
    ): Promise<BacktestResult[]> {
        return TradingBacktester.runMany(request);
    }

    /**
     * Execute a high-precision performance benchmark across strategies.
     */
    static benchmark(
        request: BatchBacktestRequest
    ): BenchmarkReport {
        const strategies = (request.strategies && request.strategies.length > 0)
            ? request.strategies.map(s => TradingBacktester.resolveStrategy(s))
            : getAllStrategies();

        const candleMap = TradingBacktester.resolveCandleMap(
            request.candleMap,
            undefined,
            request.timeframe ?? request.options?.baseTimeframe ?? '5m'
        );

        const baseTf = normalizeTimeframe(request.timeframe ?? request.options?.baseTimeframe ?? '5m');
        const baseCandles = candleMap.get(baseTf) ?? [];
        const baseBars = baseCandles.length;

        const memBefore = process.memoryUsage().heapUsed / 1024 / 1024;
        const totalTimer = new PerformanceTimer();

        const results = TradingBacktester.runMany({
            strategies,
            candleMap,
            symbol: request.symbol,
            timeframe: request.timeframe,
            options: {
                ...request.options,
                performance: {
                    enabled: true,
                    usePrecomputedIndicators: true,
                    useCompiledScript: true,
                    ...request.options?.performance,
                },
            },
        });

        const totalTimeMs = totalTimer.total();
        const memAfter = process.memoryUsage().heapUsed / 1024 / 1024;
        const totalEvaluatedBars = baseBars * strategies.length;
        const overallBarsPerSecond = totalTimeMs > 0 ? (totalEvaluatedBars / (totalTimeMs / 1000)) : 0;

        const strategyBreakdown: BenchmarkStrategyStats[] = results.map(r => {
            const timeMs = r.performance?.totalMs ?? 0;
            const bars = r.performance?.barsProcessed ?? baseBars;
            const speed = timeMs > 0 ? (bars / (timeMs / 1000)) : 0;

            return {
                strategyId: r.strategyId,
                strategyName: r.strategyName,
                executionTimeMs: Number(timeMs.toFixed(2)),
                barsPerSecond: Math.round(speed),
                totalTrades: r.totalTrades,
                winningTrades: r.wins,
                losingTrades: r.losses,
                winRate: Number((r.winRate ?? 0).toFixed(2)),
                netProfit: Number((r.netProfit ?? 0).toFixed(2)),
                netProfitPercent: Number((r.totalReturnPercent ?? r.netPnlPercent ?? 0).toFixed(2)),
                maxDrawdownPercent: Number((r.maxDrawdownPercent ?? 0).toFixed(2)),
                profitFactor: Number((r.profitFactor ?? 0).toFixed(2)),
            };
        });

        return {
            totalStrategies: strategies.length,
            totalBars: totalEvaluatedBars,
            totalTimeMs: Number(totalTimeMs.toFixed(2)),
            averageTimePerStrategyMs: Number((totalTimeMs / strategies.length).toFixed(2)),
            overallBarsPerSecond: Math.round(overallBarsPerSecond),
            heapMemoryDeltaMb: Number((memAfter - memBefore).toFixed(2)),
            currentHeapMb: Number(memAfter.toFixed(2)),
            strategyBreakdown,
        };
    }

    /**
     * Run full AI robustness & anti-overfitting analysis on a strategy.
     * Evaluates IS/OOS split, Walk-Forward Analysis, Monte Carlo simulation,
     * and Market Regime alignment into a composite 0 - 100 robustness score.
     */
    static analyzeRobustness(
        request: TradingBacktestRequest
    ): ComprehensiveRobustnessReport {
        const strategyDef = TradingBacktester.resolveStrategy(request.strategy);
        const candleMap = TradingBacktester.resolveCandleMap(
            request.candleMap,
            request.candles,
            request.timeframe ?? request.options?.baseTimeframe ?? '5m'
        );

        const options: BacktestOptions = {
            baseTimeframe: request.timeframe ?? request.options?.baseTimeframe ?? '5m',
            symbol: request.symbol ?? request.options?.symbol ?? 'BTCUSDT',
            ...request.options,
        };

        return AIRobustnessScorer.evaluate(
            strategyDef,
            candleMap,
            options
        );
    }

    /**
     * Run In-Sample Train vs Validation vs Out-of-Sample Test split analysis.
     */
    static split(
        request: TradingBacktestRequest & { ratios?: SplitAnalysisRequest['ratios'] }
    ): SplitAnalysisResult {
        const strategyDef = TradingBacktester.resolveStrategy(request.strategy);
        const candleMap = TradingBacktester.resolveCandleMap(
            request.candleMap,
            request.candles,
            request.timeframe ?? request.options?.baseTimeframe ?? '5m'
        );

        return WalkForwardEngine.runSplit({
            strategy: strategyDef,
            candleMap,
            ratios: request.ratios,
            options: request.options,
        });
    }

    /**
     * Run multi-window Walk-Forward Analysis (WFA).
     */
    static walkForward(
        request: TradingBacktestRequest & { windowsCount?: number; inSampleRatio?: number; anchored?: boolean }
    ): WalkForwardAnalysisResult {
        const strategyDef = TradingBacktester.resolveStrategy(request.strategy);
        const candleMap = TradingBacktester.resolveCandleMap(
            request.candleMap,
            request.candles,
            request.timeframe ?? request.options?.baseTimeframe ?? '5m'
        );

        return WalkForwardEngine.runWalkForward({
            strategy: strategyDef,
            candleMap,
            windowsCount: request.windowsCount,
            inSampleRatio: request.inSampleRatio,
            anchored: request.anchored,
            options: request.options,
        });
    }

    /**
     * Run Monte Carlo trade sequence resampling and ruin probability simulation.
     */
    static monteCarlo(
        trades: BacktestTrade[],
        initialCapital = 10000,
        options?: MonteCarloOptions
    ): MonteCarloSimulationResult {
        return MonteCarloSimulator.run(
            trades,
            initialCapital,
            options
        );
    }

    /**
     * Rank a batch of candidate strategies by AI Robustness Score (anti-overfitting composite).
     */
    static rankStrategies(
        request: BatchBacktestRequest
    ): ComprehensiveRobustnessReport[] {
        const strategies = (request.strategies && request.strategies.length > 0)
            ? request.strategies.map(s => TradingBacktester.resolveStrategy(s))
            : getAllStrategies();

        const candleMap = TradingBacktester.resolveCandleMap(
            request.candleMap,
            undefined,
            request.timeframe ?? request.options?.baseTimeframe ?? '5m'
        );

        const reports: ComprehensiveRobustnessReport[] = [];

        for (const strategy of strategies) {
            const report = AIRobustnessScorer.evaluate(
                strategy,
                candleMap,
                {
                    baseTimeframe: request.timeframe ?? request.options?.baseTimeframe ?? '5m',
                    symbol: request.symbol ?? request.options?.symbol ?? 'BTCUSDT',
                    ...request.options,
                }
            );
            reports.push(report);
        }

        // Sort descending by composite robustness score
        reports.sort((a, b) => b.compositeScore - a.compositeScore);
        return reports;
    }

    /**
     * Detect the active live market regime on current historical/live candles.
     */
    static detectCurrentRegime(
        candleMapInput?: Map<string, Candle[]> | Record<string, Candle[]>,
        candles?: Candle[],
        timeframe = '5m'
    ): CurrentMarketRegimeReport {
        const candleMap = TradingBacktester.resolveCandleMap(candleMapInput, candles, timeframe);
        const normBase = normalizeTimeframe(timeframe);
        const baseCandles = candleMap.get(normBase) ?? [];
        return MarketRegimeClassifier.detectCurrentRegime(baseCandles);
    }

    /**
     * Calculate cross-strategy return correlations and cluster redundancies.
     */
    static calculateCorrelation(
        request: BatchBacktestRequest
    ): StrategyCorrelationReport {
        const results = TradingBacktester.runMany(request);
        return StrategyCorrelationEngine.analyze(results);
    }

    /**
     * Select active non-redundant strategies for live deployment based on
     * current market regime suitability + historical robustness + correlation filtering.
     */
    static selectActiveStrategies(
        request: BatchBacktestRequest & { maxSelectedStrategies?: number; maxCorrelationThreshold?: number }
    ): LiveStrategySelectionReport {
        const maxSelected = request.maxSelectedStrategies ?? 3;
        const maxCorr = request.maxCorrelationThreshold ?? 0.65;

        // 1. Evaluate all candidates for robustness and current regime fit
        const reports = TradingBacktester.rankStrategies(request);

        // 2. Sort by live deploymentScore descending
        reports.sort((a, b) => b.deploymentScore - a.deploymentScore);

        // 3. Compute cross-strategy correlation
        const backtestResults = reports.map(r => r.fullBacktest);
        const correlationAnalysis = StrategyCorrelationEngine.analyze(backtestResults);

        // 4. Greedy selection: pick highest deployment scores while keeping mutual correlation < maxCorr
        const selectedReports: ComprehensiveRobustnessReport[] = [];
        const selectedIndices: number[] = [];

        for (let i = 0; i < reports.length; i++) {
            if (selectedReports.length >= maxSelected) break;
            const candidate = reports[i];

            if (!candidate.isCurrentlyDeployable && selectedReports.length > 0) {
                continue; // Do not deploy non-deployable strategies if we have alternatives
            }

            // Check correlation with previously selected strategies
            let isRedundant = false;
            for (const selIdx of selectedIndices) {
                const pairCorr = correlationAnalysis.correlationMatrix[i]?.[selIdx] ?? 0;
                if (pairCorr > maxCorr) {
                    isRedundant = true;
                    break;
                }
            }

            if (!isRedundant || selectedReports.length === 0) {
                selectedReports.push(candidate);
                selectedIndices.push(i);
            }
        }

        const currentRegimeReport = reports[0]?.currentMarketRegime ?? {
            currentRegime: 'neutral' as MarketRegime,
            regimeConfidence: 50,
            timestamp: Date.now(),
            metrics: { price: 0, adx: 20, atrRatio: 1.0, bbWidthPercent: 2.0, trendDirection: 'NEUTRAL' as const },
            recommendedStrategyCharacteristics: [],
        };

        const clusterMap = new Map<string, string>();
        for (const cl of correlationAnalysis.clusters) {
            for (const sId of cl.strategyIds) {
                clusterMap.set(sId, cl.clusterId);
            }
        }

        return {
            timestamp: currentRegimeReport.timestamp,
            currentRegime: currentRegimeReport.currentRegime,
            regimeConfidence: currentRegimeReport.regimeConfidence,
            recommendedCharacteristics: currentRegimeReport.recommendedStrategyCharacteristics,
            selectedStrategies: selectedReports.map((r, rank) => ({
                strategyId: r.strategyId,
                strategyName: r.strategyName,
                rank: rank + 1,
                deploymentScore: r.deploymentScore,
                historicalRobustnessScore: r.compositeScore,
                currentRegimeFitScore: r.currentRegimeFitScore,
                recommendation: r.deploymentRecommendation,
                clusterId: clusterMap.get(r.strategyId),
            })),
            correlationAnalysis,
            portfolioDiversificationScore: correlationAnalysis.diversificationScore,
        };
    }

    /**
     * Construct and optimize a multi-strategy capital allocation portfolio.
     */
    static constructPortfolio(
        request: PortfolioConstructionRequest
    ): PortfolioAllocationReport {
        const liveSelection = TradingBacktester.selectActiveStrategies(request);
        const strategies = (request.strategies && request.strategies.length > 0)
            ? request.strategies.map(s => TradingBacktester.resolveStrategy(s))
            : getAllStrategies();

        const candleMap = TradingBacktester.resolveCandleMap(
            request.candleMap,
            undefined,
            request.timeframe ?? request.options?.baseTimeframe ?? '5m'
        );

        // Run full backtests on candidate strategies
        const backtestResults = strategies.map(strategy =>
            Backtester.run({
                strategy,
                candleMap,
                options: {
                    baseTimeframe: request.timeframe ?? request.options?.baseTimeframe ?? '5m',
                    symbol: request.symbol ?? request.options?.symbol ?? 'BTCUSDT',
                    ...request.options,
                },
            })
        );

        const correlation = StrategyCorrelationEngine.analyze(backtestResults);

        const clusterMap = new Map<string, string>();
        for (const cl of correlation.clusters) {
            for (const sId of cl.strategyIds) clusterMap.set(sId, cl.clusterId);
        }

        const allocInput = strategies.map((strat, idx) => {
            const sel = liveSelection.selectedStrategies.find(s => s.strategyId === strat.id);
            return {
                strategyId: strat.id,
                strategyName: strat.name,
                result: backtestResults[idx],
                deploymentScore: sel?.deploymentScore ?? 50,
                clusterId: clusterMap.get(strat.id),
                targetRegime: strat.bestMarketConditions?.[0],
            };
        });

        return PortfolioOptimizer.optimize(
            allocInput,
            correlation,
            {
                model: request.allocationModel ?? 'CLUSTER_BALANCED',
                totalCapital: request.totalCapital ?? 10000,
                cashReservePercent: request.cashReservePercent ?? 10,
                maxWeightPerStrategyPercent: request.maxWeightPerStrategyPercent ?? 40,
                maxClusterExposurePercent: request.maxClusterExposurePercent ?? 45,
            }
        );
    }

    /**
     * Run Level-2 meta-strategy out-of-sample validation to verify the AI selector itself.
     */
    static validateMetaStrategy(
        request: {
            strategies?: Array<PineStrategyDefinition | string>;
            candleMap?: Map<string, Candle[]> | Record<string, Candle[]>;
            selectionRatio?: number;
            maxSelectedStrategies?: number;
            allocationModel?: AllocationModel;
            options?: BacktestOptions;
            timeframe?: string;
        }
    ): MetaStrategyValidationReport {
        const strats = (request.strategies && request.strategies.length > 0)
            ? request.strategies.map(s => TradingBacktester.resolveStrategy(s))
            : getAllStrategies();

        const candleMap = TradingBacktester.resolveCandleMap(
            request.candleMap,
            undefined,
            request.timeframe ?? request.options?.baseTimeframe ?? '5m'
        );

        return MetaStrategyValidator.validate({
            strategies: strats,
            candleMap,
            selectionRatio: request.selectionRatio ?? 0.70,
            maxSelectedStrategies: request.maxSelectedStrategies ?? 3,
            allocationModel: request.allocationModel ?? 'CLUSTER_BALANCED',
            options: request.options,
        });
    }

    /**
     * Evaluate live order execution against risk budget and circuit breaker limits.
     */
    static evaluateRiskGate(
        request: TradeEvaluationRequest,
        config: RiskGateConfig
    ): RiskGateDecision {
        return RiskExecutionGate.evaluate(request, config);
    }

    /**
     * Run dual execution backtest comparing ideal (frictionless) vs realistic (exchange microstructure) performance.
     */
    static simulateRealisticExecution(
        request: ExecutionComparisonRequest
    ): ExecutionComparisonReport {
        const stratDef = typeof request.strategy === 'string'
            ? TradingBacktester.resolveStrategy(request.strategy)
            : request.strategy;

        return ExecutionComparisonEngine.compare({
            ...request,
            strategy: stratDef,
        });
    }

    /**
     * Get predefined exchange contract specification preset (e.g. 'BINANCE_FUTURES_BTC', 'BYBIT_USDT_PERPETUAL').
     */
    static getExchangePreset(presetId: string): ExchangeContractSpec {
        return ExchangeConfig.getSpec(presetId);
    }

    /**
     * Inspect and validate OHLC data quality, sorting, and integrity.
     */
    static validateData(candles: Candle[], options?: ValidationOptions): DataQualityReport {
        return HistoricalDataValidator.validate(candles, options);
    }

    /**
     * Run a comprehensive stress test evaluation across all market disruption scenarios.
     */
    static runStressTest(request: StressTestRequest): StressTestReport {
        const stratDef = typeof request.strategy === 'string'
            ? TradingBacktester.resolveStrategy(request.strategy)
            : request.strategy;

        return StressTestRunner.run({
            ...request,
            strategy: stratDef,
        });
    }

    // ------------------------------------------------------------
    // Private Helpers
    // ------------------------------------------------------------

    private static resolveStrategy(
        strategyInput: PineStrategyDefinition | string
    ): PineStrategyDefinition {
        if (typeof strategyInput === 'string') {
            const found = STRATEGY_LIBRARY[strategyInput];
            if (!found) {
                throw new Error(
                    `[UNKNOWN_STRATEGY_ID] Strategy ID "${strategyInput}" not found in STRATEGY_LIBRARY. ` +
                    `Available IDs: ${Object.keys(STRATEGY_LIBRARY).join(', ')}`
                );
            }
            return found;
        }
        return strategyInput;
    }

    private static resolveCandleMap(
        candleMapInput?: Map<string, Candle[]> | Record<string, Candle[]>,
        singleCandles?: Candle[],
        baseTimeframe = '5m'
    ): Map<string, Candle[]> {
        const normBase = normalizeTimeframe(baseTimeframe);

        if (candleMapInput instanceof Map) {
            return candleMapInput;
        }

        if (candleMapInput && typeof candleMapInput === 'object') {
            const map = new Map<string, Candle[]>();
            for (const [tf, candles] of Object.entries(candleMapInput)) {
                map.set(normalizeTimeframe(tf), candles);
            }
            return map;
        }

        if (Array.isArray(singleCandles) && singleCandles.length > 0) {
            const map = new Map<string, Candle[]>();
            map.set(normBase, singleCandles);
            return map;
        }

        throw new Error(
            `[INVALID_CANDLE_DATA] No historical candle data provided. ` +
            `Must supply either candleMap or candles array.`
        );
    }
}
