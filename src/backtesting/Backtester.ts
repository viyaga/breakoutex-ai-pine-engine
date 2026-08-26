// ================================================================
// BreakoutEx AI — Reusable Backtester
// ================================================================

import { Candle } from '../config/types';
import {
    ActivePosition,
    BacktestOptions,
    BacktestRequest,
    BacktestResult,
    BacktestStatus,
    BacktestTrade,
    EquityPoint,
    ExitReason,
    PendingOrder,
    FillResult,
    BacktestWindow,
} from './types';

import { HistoricalDataFeed } from './HistoricalDataFeed';
import { MetricsEngine } from './MetricsEngine';
import {
    SignalDiagnostic,
    createSignalDiagnostic,
} from './SignalDiagnostics';
import {
    BacktestValidator,
    BacktestValidationResult,
} from './BacktestValidator';
import {
    BacktestContext,
    createBacktestContext,
} from './BacktestContext';
import { PineScriptCache } from './PineScriptCache';
import { PerformanceTimer, PerformanceTiming } from './PerformanceTimer';
import {
    evaluatePineScript,
    normalizeTimeframe,
    analyzeDataSufficiency,
} from '../pine/interpreter';

export class Backtester {

    private static readonly scriptCache =
        new PineScriptCache();

    /**
     * Validate a backtest result for consistency.
     */
    static validate(
        result: BacktestResult
    ): BacktestValidationResult {
        return BacktestValidator.validate(
            result
        );
    }

    /**
     * Run a single strategy.
     */
    static run(request: BacktestRequest): BacktestResult {
        const timer = new PerformanceTimer();

        // 1. Validate request
        Backtester.validateRequest(request);

        // 2. Normalize options
        const options = Backtester.normalizeOptions(
            request.options
        );

        // 3. Cache & normalize Pine Script
        const cachedScript = Backtester.scriptCache.getOrCreate(
            request.strategy.pineScript
        );
        const scriptSource = cachedScript.normalizedSource;

        // 4. Data Preparation / Shared Context
        const prepStart = PerformanceTimer.now();
        const context =
            request.context ??
            createBacktestContext(
                request.candleMap,
                options.baseTimeframe
            );

        const candleMap = context.candleMap;
        const baseTimeframe = context.baseTimeframe;
        const allBaseCandles = context.baseCandles;
        const dataPreparationMs = PerformanceTimer.now() - prepStart;

        // 5. Analyze strategy data requirements
        const sufficiency = analyzeDataSufficiency(
            scriptSource,
            baseTimeframe,
            candleMap,
            allBaseCandles.length
        );

        // 6. Fail early if data is insufficient
        if (!sufficiency.isSufficient) {
            throw new Error(
                `[INSUFFICIENT_HISTORICAL_DATA] Strategy "${request.strategy.name}" requires ` +
                `${sufficiency.requiredBaseCandles} base candles but only ${allBaseCandles.length} are available. ` +
                `Limiting factor: ${sufficiency.limitingFactor}`
            );
        }

        // 7. Validate required MTF data
        const feed = new HistoricalDataFeed(
            candleMap,
            baseTimeframe
        );

        const timeframeValidation = feed.validateRequiredTimeframes(
            scriptSource
        );

        if (timeframeValidation.missing.length > 0) {
            throw new Error(
                `[MISSING_MTF_DATA] Strategy "${request.strategy.name}" ` +
                `requires timeframe(s): ${timeframeValidation.missing.join(', ')}. ` +
                `Available: ${timeframeValidation.available.join(', ')}`
            );
        }

        // 8. Prepare warmup + test window
        const testWindow = Backtester.prepareTestWindow(
            candleMap,
            baseTimeframe,
            options.windowBars,
            options.warmupBars
        );

        // 9. Run simulation
        const simStart = PerformanceTimer.now();
        const result = Backtester.simulate(
            request.strategy,
            candleMap,
            testWindow,
            options,
            sufficiency.requiredBaseCandles,
            sufficiency.requiredDays,
            sufficiency.limitingFactor
        );
        const simulationMs = PerformanceTimer.now() - simStart;

        // 10. Validate result
        const valStart = PerformanceTimer.now();
        if (options.validateResult) {
            const validation = BacktestValidator.validate(result);
            if (!validation.valid && options.strict) {
                throw new Error(
                    `[BACKTEST_VALIDATION_FAILED] ` +
                    validation.issues
                        .map(issue => issue.message)
                        .join('; ')
                );
            }
        }
        const validationMs = PerformanceTimer.now() - valStart;

        // 11. Performance Telemetry
        if (options.performance.enabled) {
            const totalMs = timer.total();
            const barsProcessed = testWindow.testBars;
            const barsPerSecond =
                totalMs > 0
                    ? (barsProcessed / (totalMs / 1000))
                    : 0;

            result.performance = {
                totalMs: Number(totalMs.toFixed(3)),
                dataPreparationMs: Number(dataPreparationMs.toFixed(3)),
                simulationMs: Number(simulationMs.toFixed(3)),
                metricsMs: 0,
                validationMs: Number(validationMs.toFixed(3)),
                barsProcessed,
                barsPerSecond: Math.round(barsPerSecond),
            };
        }

        return result;
    }

    /**
     * Inspect the warmup and test window configuration.
     */
    static inspectWindow(
        request: BacktestRequest
    ): BacktestWindow {
        Backtester.validateRequest(request);

        const options = Backtester.normalizeOptions(
            request.options
        );

        const context =
            request.context ??
            createBacktestContext(
                request.candleMap,
                options.baseTimeframe
            );

        return Backtester.prepareTestWindow(
            context.candleMap,
            context.baseTimeframe,
            options.windowBars,
            options.warmupBars
        );
    }

    /**
     * Run multiple strategies using the same historical dataset.
     */
    static runMany(
        strategies: BacktestRequest['strategy'][],
        candleMap: Map<string, Candle[]>,
        options: BacktestOptions = {}
    ): BacktestResult[] {
        if (!Array.isArray(strategies) || strategies.length === 0) {
            return [];
        }

        const normalizedOptions =
            Backtester.normalizeOptions(options);

        const strict = normalizedOptions.strict;
        const results: BacktestResult[] = [];

        const batchTimer = new PerformanceTimer();

        // Prepare shared context once for all strategies
        const context = createBacktestContext(
            candleMap,
            normalizedOptions.baseTimeframe
        );

        for (const strategy of strategies) {
            try {
                results.push(
                    Backtester.run({
                        strategy,
                        candleMap: context.candleMap,
                        options: normalizedOptions,
                        context,
                    })
                );
            } catch (error) {
                if (strict) {
                    throw error;
                }

                const message =
                    error instanceof Error
                        ? error.message
                        : String(error);

                console.error(
                    `[BACKTEST_FAILED] ${strategy.id}: ${message}`
                );
            }
        }

        if (normalizedOptions.performance.enabled) {
            const batchMs = batchTimer.total();
            console.log(
                `[BACKTEST_BATCH] ${results.length} strategies completed in ${batchMs.toFixed(2)}ms`
            );
        }

        return Backtester.rank(results);
    }

    /**
     * Validate incoming backtest request.
     */
    private static validateRequest(
        request: BacktestRequest
    ): void {
        if (!request) {
            throw new Error(
                '[BACKTEST_INVALID_REQUEST] Request is required.'
            );
        }

        if (!request.strategy) {
            throw new Error(
                '[BACKTEST_INVALID_STRATEGY] Strategy is required.'
            );
        }

        if (
            !request.strategy.pineScript ||
            typeof request.strategy.pineScript !== 'string'
        ) {
            throw new Error(
                '[BACKTEST_INVALID_SCRIPT] Pine script is required.'
            );
        }

        if (
            !request.candleMap ||
            !(request.candleMap instanceof Map)
        ) {
            throw new Error(
                '[BACKTEST_INVALID_DATA] candleMap must be a Map.'
            );
        }
    }

    /**
     * Normalize candle map with timestamp sorting and finite value validation.
     */
    private static normalizeCandleMap(
        input: Map<string, Candle[]>
    ): Map<string, Candle[]> {
        const result = new Map<string, Candle[]>();

        for (const [rawTimeframe, candles] of input.entries()) {
            const timeframe = normalizeTimeframe(rawTimeframe);

            if (!Array.isArray(candles)) {
                continue;
            }

            const clean = candles
                .filter(
                    candle =>
                        Number.isFinite(candle.timestamp) &&
                        Number.isFinite(candle.open) &&
                        Number.isFinite(candle.high) &&
                        Number.isFinite(candle.low) &&
                        Number.isFinite(candle.close)
                )
                .slice()
                .sort((a, b) => a.timestamp - b.timestamp);

            if (clean.length > 0) {
                result.set(timeframe, clean);
            }
        }

        return result;
    }

    /**
     * Standardized default configuration.
     */
    private static normalizeOptions(
        options: BacktestOptions = {}
    ): Required<BacktestOptions> {
        return {
            baseTimeframe: options.baseTimeframe ?? '5m',

            windowBars:
                options.windowBars ?? 10_000,

            warmupBars:
                options.warmupBars ?? 2_000,

            fees: {
                entryPct:
                    options.fees?.entryPct ?? 0.04,

                exitPct:
                    options.fees?.exitPct ?? 0.04,
            },

            slippage: {
                entryPct:
                    options.slippage?.entryPct ?? 0.03,

                exitPct:
                    options.slippage?.exitPct ?? 0.03,
            },

            execution: {
                processOrdersOnClose:
                    options.execution?.processOrdersOnClose ?? false,

                allowReversal:
                    options.execution?.allowReversal ?? true,

                maxOpenPositions:
                    options.execution?.maxOpenPositions ?? 1,

                trailingStopAtrMultiplier:
                    options.execution?.trailingStopAtrMultiplier,

                sameBarExitPolicy:
                    options.execution?.sameBarExitPolicy ??
                    'conservative',
            },

            capital: {
                initial:
                    options.capital?.initial ?? 10_000,

                enabled:
                    options.capital?.enabled ?? true,
            },

            positionSizing: {
                mode:
                    options.positionSizing?.mode ?? 'percentage',

                capitalPercent:
                    options.positionSizing?.capitalPercent ?? 100,

                fixedCapital:
                    options.positionSizing?.fixedCapital,

                riskPercent:
                    options.positionSizing?.riskPercent,

                leverage:
                    options.positionSizing?.leverage ?? 1,
            },

            minSampleSize:
                options.minSampleSize ?? 4,

            diagnostics: {
                collectSignals:
                    options.diagnostics?.collectSignals ??
                    false,

                actionableOnly:
                    options.diagnostics?.actionableOnly ??
                    true,

                maxSignalRecords:
                    options.diagnostics?.maxSignalRecords ??
                    10_000,
            },

            validateResult:
                options.validateResult ?? true,

            strict:
                options.strict ?? false,

            performance: {
                enabled:
                    options.performance?.enabled ?? false,
            },
        };
    }

    // ================================================================
    // PART 6 — Prepare Warmup + Test Window
    // ================================================================

    private static prepareTestWindow(
        candleMap: Map<string, Candle[]>,
        baseTimeframe: string,
        windowBars: number,
        warmupBars: number
    ): BacktestWindow {

        const normalizedTf =
            normalizeTimeframe(
                baseTimeframe
            );

        const allCandles =
            candleMap.get(
                normalizedTf
            ) ?? [];

        if (
            allCandles.length < 2
        ) {
            throw new Error(
                `[BACKTEST_NO_DATA] ` +
                `Not enough ${normalizedTf} candles.`
            );
        }

        // ------------------------------------------------------------
        // Keep the latest windowBars as the actual test period.
        // ------------------------------------------------------------

        const actualTestBars =
            Math.min(
                Math.max(
                    1,
                    windowBars
                ),
                allCandles.length
            );

        const testStartIndex =
            allCandles.length -
            actualTestBars;

        // ------------------------------------------------------------
        // Warmup starts before the test period.
        // ------------------------------------------------------------

        const warmupStartIndex =
            Math.max(
                0,
                testStartIndex -
                Math.max(
                    0,
                    warmupBars
                )
            );

        const warmupCandles =
            allCandles.slice(
                warmupStartIndex,
                testStartIndex
            );

        const testCandles =
            allCandles.slice(
                testStartIndex
            );

        if (
            testCandles.length < 2
        ) {
            throw new Error(
                `[BACKTEST_INSUFFICIENT_TEST_DATA] ` +
                `At least 2 test candles are required.`
            );
        }

        const testStart =
            testCandles[0];

        const testEnd =
            testCandles[
                testCandles.length - 1
            ];

        return {

            baseTimeframe:
                normalizedTf,

            allCandles,

            warmupCandles,

            testCandles,

            warmupStartTimestamp:
                warmupCandles.length > 0
                    ? warmupCandles[0].timestamp
                    : testStart.timestamp,

            testStartTimestamp:
                testStart.timestamp,

            testEndTimestamp:
                testEnd.timestamp,

            warmupBars:
                warmupCandles.length,

            testBars:
                testCandles.length,
        };
    }

    // ================================================================
    // PART 3, 4, 6 — Core Backtest Simulation
    // ================================================================

    private static simulate(
        strategy: BacktestRequest['strategy'],
        candleMap: Map<string, Candle[]>,
        testWindow: BacktestWindow,
        options: Required<BacktestOptions>,
        requiredBaseCandles: number,
        requiredDays: number,
        limitingFactor: string
    ): BacktestResult {

        const testCandles =
            testWindow.testCandles;

        const baseTimeframe =
            testWindow.baseTimeframe;

        const n =
            testCandles.length;

        // ------------------------------------------------------------
        // Configuration
        // ------------------------------------------------------------

        const entryFeePct = options.fees.entryPct;
        const exitFeePct = options.fees.exitPct;

        const entrySlipPct = options.slippage.entryPct;
        const exitSlipPct = options.slippage.exitPct;

        const processOrdersOnClose =
            options.execution.processOrdersOnClose ?? false;

        const allowReversal =
            options.execution.allowReversal ?? true;

        const initialCapital =
            options.capital.initial;

        const capitalEnabled =
            options.capital.enabled ?? true;

        const minSampleSize =
            options.minSampleSize;

        const defaultTpPct =
            strategy.defaultTpPercent / 100;

        const defaultSlPct =
            strategy.defaultSlPercent / 100;

        // ------------------------------------------------------------
        // State
        // ------------------------------------------------------------

        const trades: BacktestTrade[] = [];

        const equityCurve: EquityPoint[] = [];

        let currentPos: ActivePosition | null = null;

        let pendingOrder: PendingOrder | null = null;

        let tradeCounter = 0;

        let currentCapital = initialCapital;

        let peakCapital = initialCapital;

        let maxDrawdownAmount = 0;

        let maxDrawdownPercent = 0;

        let maxDrawdownBars = 0;

        let currentDrawdownStartBar = -1;

        let maxRunUpPercent = 0;

        let grossProfit = 0;

        let grossLoss = 0;

        let totalFees = 0;

        let totalSlippage = 0;

        let currentWinStreak = 0;

        let currentLossStreak = 0;

        let maxWinStreak = 0;

        let maxLossStreak = 0;

        let signalErrors = 0;

        let executionErrors = 0;

        let lookaheadWarnings = 0;

        const signalDiagnostics:
            SignalDiagnostic[] = [];

        // ------------------------------------------------------------
        // Historical Data Feed
        // ------------------------------------------------------------

        const dataFeed =
            new HistoricalDataFeed(
                candleMap,
                baseTimeframe
            );

        dataFeed.reset();

        // ------------------------------------------------------------
        // Initial equity point
        // ------------------------------------------------------------

        equityCurve.push({
            timestamp: testCandles[0].timestamp,
            equityPercent: 0,
            equity: currentCapital,
            drawdownPercent: 0,
            drawdown: 0,
        });

        // ------------------------------------------------------------
        // Main historical simulation loop
        // ------------------------------------------------------------

        for (let i = 0; i < n; i++) {

            const currentBar = testCandles[i];

            if (!currentBar) {
                continue;
            }

            const isBullishBar =
                currentBar.close >= currentBar.open;

            // ========================================================
            // 1. EXECUTE PENDING ORDER
            //
            // Signal on bar N:
            //
            //     N signal
            //       ↓
            //     N+1 open execution
            //
            // This is the default behavior.
            // ========================================================

            if (pendingOrder && !processOrdersOnClose) {

                try {

                    const order = pendingOrder;

                    const isBuy =
                        order.action === 'buy';

                    // ------------------------------------------------
                    // Reverse existing position if necessary
                    // ------------------------------------------------

                    if (
                        currentPos &&
                        allowReversal &&
                        (
                            (isBuy && currentPos.side === 'short') ||
                            (!isBuy && currentPos.side === 'long')
                        )
                    ) {

                        Backtester.closePosition(
                            currentPos,
                            currentBar.open,
                            currentBar.timestamp,
                            i,
                            'reversal',
                            trades,
                            {
                                exitFeePct,
                                exitSlipPct,
                                capitalEnabled,
                                currentCapital,
                            }
                        );

                        const lastTrade =
                            trades[trades.length - 1];

                        if (lastTrade) {

                            currentCapital =
                                lastTrade.capitalAfter ??
                                currentCapital;

                            totalFees +=
                                lastTrade.feePercent;

                            totalSlippage +=
                                lastTrade.slippagePercent;

                            if (lastTrade.netPnlPercent > 0.01) {
                                currentWinStreak++;
                                currentLossStreak = 0;
                                maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
                            } else if (lastTrade.netPnlPercent < -0.01) {
                                currentLossStreak++;
                                currentWinStreak = 0;
                                maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
                            } else {
                                currentWinStreak = 0;
                                currentLossStreak = 0;
                            }
                        }

                        currentPos = null;
                    }

                    // ------------------------------------------------
                    // Open new position
                    // ------------------------------------------------

                    if (!currentPos) {

                        tradeCounter++;

                        const side =
                            isBuy
                                ? 'long'
                                : 'short';

                        const rawEntryPrice =
                            currentBar.open;

                        const quantity =
                            Backtester.calculateQuantity(
                                currentCapital,
                                rawEntryPrice,
                                order.sl,
                                options
                            );

                        const entryFill =
                            Backtester.createEntryFill(
                                rawEntryPrice,
                                side,
                                quantity,
                                entryFeePct,
                                entrySlipPct
                            );

                        const tp =
                            order.tp ??
                            (
                                isBuy
                                    ? rawEntryPrice * (1 + defaultTpPct)
                                    : rawEntryPrice * (1 - defaultTpPct)
                            );

                        const sl =
                            order.sl ??
                            (
                                isBuy
                                    ? rawEntryPrice * (1 - defaultSlPct)
                                    : rawEntryPrice * (1 + defaultSlPct)
                            );

                        currentPos = {
                            tradeNumber: tradeCounter,

                            side,

                            entryTimestamp:
                                currentBar.timestamp,

                            rawEntryPrice,

                            entryPrice:
                                entryFill.fillPrice,

                            entryBarIndex: i,

                            targetTp: tp,

                            targetSl: sl,

                            highestPrice:
                                entryFill.fillPrice,

                            lowestPrice:
                                entryFill.fillPrice,

                            quantity,

                            capitalBefore:
                                currentCapital,

                            notionalValue:
                                entryFill.notionalValue,

                            entryFeeAmount:
                                entryFill.feeAmount,

                            entrySlippageAmount:
                                entryFill.slippageAmount,

                            entryFeePercent:
                                entryFill.feePercent,

                            entrySlippagePercent:
                                entryFill.slippagePercent,
                        };
                    }

                    pendingOrder = null;

                } catch (error) {

                    executionErrors++;

                    console.warn(
                        '[BACKTEST_EXECUTION_ERROR]',
                        error
                    );

                    pendingOrder = null;
                }
            }

            // ========================================================
            // 2. PROCESS ACTIVE POSITION
            // ========================================================

            if (currentPos) {

                currentPos.highestPrice =
                    Math.max(
                        currentPos.highestPrice,
                        currentBar.high
                    );

                currentPos.lowestPrice =
                    Math.min(
                        currentPos.lowestPrice,
                        currentBar.low
                    );

                let exited = false;

                let exitPrice = 0;

                let exitReason: ExitReason =
                    'market_close';

                // ----------------------------------------------------
                // LONG
                // ----------------------------------------------------

                if (currentPos.side === 'long') {
                    const tpHit =
                        currentBar.high >= currentPos.targetTp;
                    const slHit =
                        currentBar.low <= currentPos.targetSl;

                    if (tpHit && slHit) {
                        const policy =
                            options.execution.sameBarExitPolicy ??
                            'conservative';

                        if (
                            policy === 'stop_first' ||
                            policy === 'conservative'
                        ) {
                            exitPrice = currentPos.targetSl;
                            exitReason = 'sl';
                            exited = true;
                        } else if (policy === 'target_first') {
                            exitPrice = currentPos.targetTp;
                            exitReason = 'tp';
                            exited = true;
                        } else if (policy === 'nearest') {
                            const distTp = Math.abs(currentBar.open - currentPos.targetTp);
                            const distSl = Math.abs(currentBar.open - currentPos.targetSl);
                            if (distTp <= distSl) {
                                exitPrice = currentPos.targetTp;
                                exitReason = 'tp';
                            } else {
                                exitPrice = currentPos.targetSl;
                                exitReason = 'sl';
                            }
                            exited = true;
                        }
                    } else if (isBullishBar) {
                        if (slHit) {
                            exitPrice = currentPos.targetSl;
                            exitReason = 'sl';
                            exited = true;
                        } else if (tpHit) {
                            exitPrice = currentPos.targetTp;
                            exitReason = 'tp';
                            exited = true;
                        }
                    } else {
                        if (tpHit) {
                            exitPrice = currentPos.targetTp;
                            exitReason = 'tp';
                            exited = true;
                        } else if (slHit) {
                            exitPrice = currentPos.targetSl;
                            exitReason = 'sl';
                            exited = true;
                        }
                    }
                }

                // ----------------------------------------------------
                // SHORT
                // ----------------------------------------------------

                else {
                    const tpHit =
                        currentBar.low <= currentPos.targetTp;
                    const slHit =
                        currentBar.high >= currentPos.targetSl;

                    if (tpHit && slHit) {
                        const policy =
                            options.execution.sameBarExitPolicy ??
                            'conservative';

                        if (
                            policy === 'stop_first' ||
                            policy === 'conservative'
                        ) {
                            exitPrice = currentPos.targetSl;
                            exitReason = 'sl';
                            exited = true;
                        } else if (policy === 'target_first') {
                            exitPrice = currentPos.targetTp;
                            exitReason = 'tp';
                            exited = true;
                        } else if (policy === 'nearest') {
                            const distTp = Math.abs(currentBar.open - currentPos.targetTp);
                            const distSl = Math.abs(currentBar.open - currentPos.targetSl);
                            if (distTp <= distSl) {
                                exitPrice = currentPos.targetTp;
                                exitReason = 'tp';
                            } else {
                                exitPrice = currentPos.targetSl;
                                exitReason = 'sl';
                            }
                            exited = true;
                        }
                    } else if (isBullishBar) {
                        if (tpHit) {
                            exitPrice = currentPos.targetTp;
                            exitReason = 'tp';
                            exited = true;
                        } else if (slHit) {
                            exitPrice = currentPos.targetSl;
                            exitReason = 'sl';
                            exited = true;
                        }
                    } else {
                        if (slHit) {
                            exitPrice = currentPos.targetSl;
                            exitReason = 'sl';
                            exited = true;
                        } else if (tpHit) {
                            exitPrice = currentPos.targetTp;
                            exitReason = 'tp';
                            exited = true;
                        }
                    }
                }

                // ----------------------------------------------------
                // Close position
                // ----------------------------------------------------

                if (exited) {

                    Backtester.closePosition(
                        currentPos,
                        exitPrice,
                        currentBar.timestamp,
                        i,
                        exitReason,
                        trades,
                        {
                            exitFeePct,
                            exitSlipPct,
                            capitalEnabled,
                            currentCapital,
                        }
                    );

                    const lastTrade =
                        trades[trades.length - 1];

                    if (lastTrade) {

                        currentCapital =
                            lastTrade.capitalAfter ??
                            currentCapital;

                        totalFees +=
                            lastTrade.feePercent;

                        totalSlippage +=
                            lastTrade.slippagePercent;

                        if (lastTrade.netPnlPercent > 0.01) {
                            currentWinStreak++;
                            currentLossStreak = 0;
                            maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
                        } else if (lastTrade.netPnlPercent < -0.01) {
                            currentLossStreak++;
                            currentWinStreak = 0;
                            maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
                        } else {
                            currentWinStreak = 0;
                            currentLossStreak = 0;
                        }
                    }

                    currentPos = null;
                }
            }

            // ========================================================
            // 3. EVALUATE STRATEGY SIGNAL
            //
            // Only candles <= current timestamp are supplied to the
            // interpreter.
            // ========================================================

            if (i < n - 1) {

                try {

                    dataFeed.advanceTo(
                        currentBar.timestamp
                    );

                    const sliceMap =
                        dataFeed.getSnapshot();

                    // ------------------------------------------------
                    // Evaluate Pine
                    // ------------------------------------------------

                    const signal =
                        evaluatePineScript(
                            strategy.pineScript,
                            sliceMap,
                            baseTimeframe
                        );

                    if (
                        options.diagnostics?.collectSignals
                    ) {

                        const shouldCollect =
                            !options.diagnostics.actionableOnly ||
                            signal.action === 'buy' ||
                            signal.action === 'sell' ||
                            signal.action === 'close';

                        const maxRecords =
                            options.diagnostics.maxSignalRecords ??
                            10_000;

                        if (
                            shouldCollect &&
                            signalDiagnostics.length <
                            maxRecords
                        ) {

                            signalDiagnostics.push(
                                createSignalDiagnostic(
                                    i,
                                    currentBar,
                                    signal
                                )
                            );
                        }
                    }

                    // ------------------------------------------------
                    // BUY / SELL
                    // ------------------------------------------------

                    if (
                        signal.action === 'buy' ||
                        signal.action === 'sell'
                    ) {

                        const isBuy =
                            signal.action === 'buy';

                        const referencePrice =
                            currentBar.close;

                        let tp =
                            signal.tp;

                        let sl =
                            signal.sl;

                        // --------------------------------------------
                        // Validate TP/SL
                        // --------------------------------------------

                        if (isBuy) {

                            tp =
                                tp !== undefined &&
                                tp > referencePrice
                                    ? tp
                                    : referencePrice *
                                      (1 + defaultTpPct);

                            sl =
                                sl !== undefined &&
                                sl < referencePrice
                                    ? sl
                                    : referencePrice *
                                      (1 - defaultSlPct);

                        } else {

                            tp =
                                tp !== undefined &&
                                tp < referencePrice
                                    ? tp
                                    : referencePrice *
                                      (1 - defaultTpPct);

                            sl =
                                sl !== undefined &&
                                sl > referencePrice
                                    ? sl
                                    : referencePrice *
                                      (1 + defaultSlPct);
                        }

                        // --------------------------------------------
                        // Same-bar close execution
                        // --------------------------------------------

                        if (processOrdersOnClose) {

                            if (
                                currentPos &&
                                (
                                    (isBuy &&
                                        currentPos.side === 'short') ||
                                    (!isBuy &&
                                        currentPos.side === 'long')
                                )
                            ) {

                                Backtester.closePosition(
                                    currentPos,
                                    currentBar.close,
                                    currentBar.timestamp,
                                    i,
                                    'reversal',
                                    trades,
                                    {
                                        exitFeePct,
                                        exitSlipPct,
                                        capitalEnabled,
                                        currentCapital,
                                    }
                                );

                                const lastTrade =
                                    trades[trades.length - 1];

                                if (lastTrade) {

                                    currentCapital =
                                        lastTrade.capitalAfter ??
                                        currentCapital;

                                    totalFees +=
                                        lastTrade.feePercent;

                                    totalSlippage +=
                                        lastTrade.slippagePercent;

                                    if (lastTrade.netPnlPercent > 0.01) {
                                        currentWinStreak++;
                                        currentLossStreak = 0;
                                        maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
                                    } else if (lastTrade.netPnlPercent < -0.01) {
                                        currentLossStreak++;
                                        currentWinStreak = 0;
                                        maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
                                    } else {
                                        currentWinStreak = 0;
                                        currentLossStreak = 0;
                                    }
                                }

                                currentPos = null;
                            }

                            if (!currentPos) {

                                tradeCounter++;

                                const side =
                                    isBuy
                                        ? 'long'
                                        : 'short';

                                const rawEntryPrice =
                                    referencePrice;

                                const quantity =
                                    Backtester.calculateQuantity(
                                        currentCapital,
                                        rawEntryPrice,
                                        sl,
                                        options
                                    );

                                const entryFill =
                                    Backtester.createEntryFill(
                                        rawEntryPrice,
                                        side,
                                        quantity,
                                        entryFeePct,
                                        entrySlipPct
                                    );

                                currentPos = {

                                    tradeNumber:
                                        tradeCounter,

                                    side,

                                    entryTimestamp:
                                        currentBar.timestamp,

                                    rawEntryPrice,

                                    entryPrice:
                                        entryFill.fillPrice,

                                    entryBarIndex: i,

                                    targetTp: tp,

                                    targetSl: sl,

                                    highestPrice:
                                        entryFill.fillPrice,

                                    lowestPrice:
                                        entryFill.fillPrice,

                                    quantity,

                                    capitalBefore:
                                        currentCapital,

                                    notionalValue:
                                        entryFill.notionalValue,

                                    entryFeeAmount:
                                        entryFill.feeAmount,

                                    entrySlippageAmount:
                                        entryFill.slippageAmount,

                                    entryFeePercent:
                                        entryFill.feePercent,

                                    entrySlippagePercent:
                                        entryFill.slippagePercent,
                                };
                            }

                        }

                        // --------------------------------------------
                        // Default Pine behavior:
                        // queue order for next bar open.
                        // --------------------------------------------

                        else {

                            pendingOrder = {

                                action:
                                    signal.action,

                                tp,

                                sl,

                                signalBarIndex:
                                    i,

                                signalTimestamp:
                                    currentBar.timestamp,
                        };
                    }

                }

                // ------------------------------------------------
                // CLOSE
                // ------------------------------------------------

                else if (
                    signal.action === 'close' &&
                    currentPos
                ) {

                    Backtester.closePosition(
                        currentPos,
                        currentBar.close,
                        currentBar.timestamp,
                        i,
                        'close_signal',
                        trades,
                        {
                            exitFeePct,
                            exitSlipPct,
                            capitalEnabled,
                            currentCapital,
                        }
                    );

                    const lastTrade =
                        trades[trades.length - 1];

                    if (lastTrade) {

                        currentCapital =
                            lastTrade.capitalAfter ??
                            currentCapital;

                        totalFees +=
                            lastTrade.feePercent;

                        totalSlippage +=
                            lastTrade.slippagePercent;

                        if (lastTrade.netPnlPercent > 0.01) {
                            currentWinStreak++;
                            currentLossStreak = 0;
                            maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
                        } else if (lastTrade.netPnlPercent < -0.01) {
                            currentLossStreak++;
                            currentWinStreak = 0;
                            maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
                        } else {
                            currentWinStreak = 0;
                            currentLossStreak = 0;
                        }
                    }

                    currentPos = null;
                }

            } catch (error) {

                signalErrors++;

                // Do not terminate the entire backtest
                // because one historical evaluation failed.

                console.warn(
                    `[BACKTEST_SIGNAL_ERROR] ` +
                    `${strategy.id} @ ${currentBar.timestamp}`,
                    error
                );
            }
        }

        // ========================================================
        // 4. UPDATE EQUITY / DRAWDOWN
        // ========================================================

        const equityPercent =
            initialCapital > 0
                ? (
                    (currentCapital -
                        initialCapital) /
                    initialCapital
                ) * 100
                : 0;

        if (currentCapital > peakCapital) {

            peakCapital =
                currentCapital;

            currentDrawdownStartBar =
                -1;

        } else {

            if (
                currentDrawdownStartBar === -1
            ) {

                currentDrawdownStartBar =
                    i;
            }

            const drawdown =
                peakCapital -
                currentCapital;

            const drawdownPct =
                peakCapital > 0
                    ? (
                        drawdown /
                        peakCapital
                    ) * 100
                    : 0;

            if (
                drawdown >
                maxDrawdownAmount
            ) {

                maxDrawdownAmount =
                    drawdown;

                maxDrawdownPercent =
                    drawdownPct;

                maxDrawdownBars =
                    i -
                    currentDrawdownStartBar;
            }
        }

        maxRunUpPercent =
            Math.max(
                maxRunUpPercent,
                equityPercent
            );

        equityCurve.push({

            timestamp:
                currentBar.timestamp,

            equityPercent:
                Number(
                    equityPercent.toFixed(4)
                ),

            equity:
                Number(
                    currentCapital.toFixed(2)
                ),

            drawdownPercent:
                Number(
                    (
                        peakCapital -
                        currentCapital
                    ).toFixed(4)
                ),

            drawdown:
                Number(
                    (
                        peakCapital -
                        currentCapital
                    ).toFixed(2)
                ),
        });
    }

    // ============================================================
    // 5. FORCE-CLOSE REMAINING POSITION
    // ============================================================

    if (currentPos && n > 0) {

        const finalBar =
            testCandles[n - 1];

        Backtester.closePosition(
            currentPos,
            finalBar.close,
            finalBar.timestamp,
            n - 1,
            'market_close',
            trades,
            {
                exitFeePct,
                exitSlipPct,
                capitalEnabled,
                currentCapital,
            }
        );

        const lastTrade =
            trades[trades.length - 1];

        if (lastTrade) {

            currentCapital =
                lastTrade.capitalAfter ??
                currentCapital;

            totalFees +=
                lastTrade.feePercent;

            totalSlippage +=
                lastTrade.slippagePercent;
        }

        currentPos = null;
    }

        // ============================================================
        // 6. BUILD METRICS (MetricsEngine)
        // ============================================================

        const metrics =
            MetricsEngine.calculate({
                trades,
                equityCurve,
                initialCapital,
                finalCapital:
                    currentCapital,
                baseTimeframe,
                minSampleSize:
                    options.minSampleSize,
            });

        // ============================================================
        // 7. FINAL RESULT
        // ============================================================

        return {
            strategyId:
                strategy.id,

            strategyName:
                strategy.name,

            initialCapital:
                Number(
                    initialCapital.toFixed(2)
                ),

            finalCapital:
                Number(
                    currentCapital.toFixed(2)
                ),

            ...metrics,

            trades,

            equityCurve,

            signalDiagnostics,

            diagnostics: {
                insufficientData:
                    false,

                requiredBaseCandles,

                availableBaseCandles:
                    testWindow.allCandles.length,

                requiredDays,

                limitingFactor,

                executionErrors,

                signalErrors,

                lookaheadWarnings,

                warmupBars:
                    testWindow.warmupBars,

                testBars:
                    testWindow.testBars,

                testStartTimestamp:
                    testWindow.testStartTimestamp,

                testEndTimestamp:
                    testWindow.testEndTimestamp,
            },
        };
    }

    // ================================================================
    // PART 4 — Execution / Fill Model
    // ================================================================

    private static createEntryFill(
        rawPrice: number,
        side: 'long' | 'short',
        quantity: number,
        feePct: number,
        slippagePct: number
    ): FillResult {

        if (
            !Number.isFinite(rawPrice) ||
            rawPrice <= 0
        ) {
            throw new Error(
                `[INVALID_ENTRY_PRICE] ${rawPrice}`
            );
        }

        if (
            !Number.isFinite(quantity) ||
            quantity <= 0
        ) {
            throw new Error(
                `[INVALID_POSITION_QUANTITY] ${quantity}`
            );
        }

        const isLong =
            side === 'long';

        const fillPrice =
            Backtester.applyEntrySlippage(
                rawPrice,
                isLong,
                slippagePct
            );

        const notionalValue =
            fillPrice *
            quantity;

        const feeAmount =
            notionalValue *
            (feePct / 100);

        const slippageAmount =
            Math.abs(
                fillPrice -
                rawPrice
            ) *
            quantity;

        return {
            rawPrice,

            fillPrice,

            quantity,

            notionalValue,

            feeAmount,

            slippageAmount,

            feePercent:
                feePct,

            slippagePercent:
                slippagePct,
        };
    }

    // ================================================================
    // Exit fill
    // ================================================================

    private static createExitFill(
        rawPrice: number,
        side: 'long' | 'short',
        quantity: number,
        feePct: number,
        slippagePct: number
    ): FillResult {

        if (
            !Number.isFinite(rawPrice) ||
            rawPrice <= 0
        ) {
            throw new Error(
                `[INVALID_EXIT_PRICE] ${rawPrice}`
            );
        }

        if (
            !Number.isFinite(quantity) ||
            quantity <= 0
        ) {
            throw new Error(
                `[INVALID_EXIT_QUANTITY] ${quantity}`
            );
        }

        const isLong =
            side === 'long';

        const fillPrice =
            Backtester.applyExitSlippage(
                rawPrice,
                isLong,
                slippagePct
            );

        const notionalValue =
            fillPrice *
            quantity;

        const feeAmount =
            notionalValue *
            (feePct / 100);

        const slippageAmount =
            Math.abs(
                fillPrice -
                rawPrice
            ) *
            quantity;

        return {
            rawPrice,

            fillPrice,

            quantity,

            notionalValue,

            feeAmount,

            slippageAmount,

            feePercent:
                feePct,

            slippagePercent:
                slippagePct,
        };
    }

    // ================================================================
    // Apply entry slippage
    // ================================================================

    private static applyEntrySlippage(
        price: number,
        isLong: boolean,
        slippagePct: number
    ): number {

        const slip =
            slippagePct / 100;

        return isLong
            ? price * (1 + slip)
            : price * (1 - slip);
    }

    // ================================================================
    // Apply exit slippage
    // ================================================================

    private static applyExitSlippage(
        price: number,
        isLong: boolean,
        slippagePct: number
    ): number {

        const slip =
            slippagePct / 100;

        return isLong
            ? price * (1 - slip)
            : price * (1 + slip);
    }

    // ================================================================
    // Calculate position quantity
    // ================================================================

    private static calculateQuantity(
        capital: number,
        entryPrice: number,
        stopPrice: number | undefined,
        options: Required<BacktestOptions>
    ): number {

        if (
            !Number.isFinite(capital) ||
            capital <= 0 ||
            !Number.isFinite(entryPrice) ||
            entryPrice <= 0
        ) {
            return 0;
        }

        const sizing =
            options.positionSizing;

        const leverage =
            Math.max(
                1,
                sizing.leverage ?? 1
            );

        // ------------------------------------------------------------
        // Fixed capital
        // ------------------------------------------------------------

        if (
            sizing.mode ===
            'fixed-capital'
        ) {

            const capitalToUse =
                Math.min(
                    capital,
                    sizing.fixedCapital ??
                    capital
                );

            return (
                capitalToUse *
                leverage
            ) / entryPrice;
        }

        // ------------------------------------------------------------
        // Fixed risk
        // ------------------------------------------------------------

        if (
            sizing.mode ===
            'fixed-risk' &&
            stopPrice !== undefined &&
            Number.isFinite(stopPrice)
        ) {

            const riskPercent =
                sizing.riskPercent ??
                1;

            const riskAmount =
                capital *
                (riskPercent / 100);

            const priceRisk =
                Math.abs(
                    entryPrice -
                    stopPrice
                );

            if (
                priceRisk <= 0
            ) {

                return 0;
            }

            return (
                riskAmount /
                priceRisk
            ) * leverage;
        }

        // ------------------------------------------------------------
        // Percentage of capital
        // ------------------------------------------------------------

        const capitalPercent =
            sizing.capitalPercent ??
            100;

        const capitalToUse =
            capital *
            (capitalPercent / 100);

        return (
            capitalToUse *
            leverage
        ) / entryPrice;
    }

    // ================================================================
    // Close a position and create a trade record
    // ================================================================

    private static closePosition(
        pos: ActivePosition,
        rawExitPrice: number,
        exitTimestamp: number,
        exitBarIndex: number,
        reason: ExitReason,
        trades: BacktestTrade[],
        config: {
            exitFeePct: number;
            exitSlipPct: number;
            capitalEnabled: boolean;
            currentCapital: number;
        }
    ): void {

        // ------------------------------------------------------------
        // Exit fill
        // ------------------------------------------------------------

        const exitFill =
            Backtester.createExitFill(
                rawExitPrice,
                pos.side,
                pos.quantity,
                config.exitFeePct,
                config.exitSlipPct
            );

        const isLong =
            pos.side === 'long';

        // ------------------------------------------------------------
        // Gross price P&L
        // ------------------------------------------------------------

        const grossPricePnl =
            isLong
                ? (
                    exitFill.fillPrice -
                    pos.entryPrice
                ) * pos.quantity
                : (
                    pos.entryPrice -
                    exitFill.fillPrice
                ) * pos.quantity;

        // ------------------------------------------------------------
        // Total trading costs
        //
        // Entry costs were already incurred when the position
        // was opened. They must be included here when calculating
        // the complete trade result.
        // ------------------------------------------------------------

        const totalFees =
            pos.entryFeeAmount +
            exitFill.feeAmount;

        const totalSlippage =
            pos.entrySlippageAmount +
            exitFill.slippageAmount;

        void totalSlippage;

        // ------------------------------------------------------------
        // Net P&L
        // ------------------------------------------------------------

        const netPnl =
            grossPricePnl -
            totalFees;

        // ------------------------------------------------------------
        // Percentage P&L
        //
        // Use entry notional as denominator.
        // ------------------------------------------------------------

        const entryNotional =
            pos.notionalValue;

        const grossPnlPercent =
            entryNotional > 0
                ? (
                    grossPricePnl /
                    entryNotional
                ) * 100
                : 0;

        const netPnlPercent =
            entryNotional > 0
                ? (
                    netPnl /
                    entryNotional
                ) * 100
                : 0;

        const totalFeePercent =
            pos.entryFeePercent +
            exitFill.feePercent;

        const totalSlippagePercent =
            pos.entrySlippagePercent +
            exitFill.slippagePercent;

        // ------------------------------------------------------------
        // MAE / MFE
        // ------------------------------------------------------------

        const maxRunUpPercent =
            isLong
                ? (
                    (
                        pos.highestPrice -
                        pos.entryPrice
                    ) /
                    pos.entryPrice
                ) * 100
                : (
                    (
                        pos.entryPrice -
                        pos.lowestPrice
                    ) /
                    pos.entryPrice
                ) * 100;

        const maxDrawdownPercent =
            isLong
                ? (
                    (
                        pos.entryPrice -
                        pos.lowestPrice
                    ) /
                    pos.entryPrice
                ) * 100
                : (
                    (
                        pos.highestPrice -
                        pos.entryPrice
                    ) /
                    pos.entryPrice
                ) * 100;

        // ------------------------------------------------------------
        // Capital after trade
        // ------------------------------------------------------------

        const capitalAfter =
            config.capitalEnabled
                ? config.currentCapital +
                  netPnl
                : config.currentCapital;

        // ------------------------------------------------------------
        // Trade record
        // ------------------------------------------------------------

        const trade: BacktestTrade = {

            tradeNumber:
                pos.tradeNumber,

            side:
                pos.side,

            entryTimestamp:
                pos.entryTimestamp,

            exitTimestamp,

            entryPrice:
                Number(
                    pos.entryPrice.toFixed(8)
                ),

            exitPrice:
                Number(
                    exitFill.fillPrice.toFixed(8)
                ),

            entryBarIndex:
                pos.entryBarIndex,

            exitBarIndex,

            barsHeld:
                Math.max(
                    1,
                    exitBarIndex -
                    pos.entryBarIndex
                ),

            grossPnlPercent:
                Number(
                    grossPnlPercent.toFixed(4)
                ),

            netPnlPercent:
                Number(
                    netPnlPercent.toFixed(4)
                ),

            feePercent:
                Number(
                    totalFeePercent.toFixed(4)
                ),

            slippagePercent:
                Number(
                    totalSlippagePercent.toFixed(4)
                ),

            exitReason:
                reason,

            maxRunUpPercent:
                Number(
                    maxRunUpPercent.toFixed(4)
                ),

            maxDrawdownPercent:
                Number(
                    maxDrawdownPercent.toFixed(4)
                ),

            quantity:
                Number(
                    pos.quantity.toFixed(8)
                ),

            grossPnl:
                Number(
                    grossPricePnl.toFixed(2)
                ),

            netPnl:
                Number(
                    netPnl.toFixed(2)
                ),

            capitalBefore:
                Number(
                    config.currentCapital.toFixed(2)
                ),

            capitalAfter:
                Number(
                    capitalAfter.toFixed(2)
                ),
        };

        trades.push(trade);
    }

    /**
     * Rank strategies consistently.
     */
    static rank(
        results: BacktestResult[]
    ): BacktestResult[] {

        const statusPriority: Record<string, number> = {
            profitable: 1,
            neutral: 2,
            insufficient_sample: 3,
            no_triggers: 4,
            losing: 5,
        };

        return [...results].sort((a, b) => {

            const priorityA =
                statusPriority[a.status] ?? 99;

            const priorityB =
                statusPriority[b.status] ?? 99;

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            if (b.sharpeRatio !== a.sharpeRatio) {
                return b.sharpeRatio - a.sharpeRatio;
            }

            if (b.profitFactor !== a.profitFactor) {
                return b.profitFactor - a.profitFactor;
            }

            return b.netPnlPercent - a.netPnlPercent;
        });
    }
}
