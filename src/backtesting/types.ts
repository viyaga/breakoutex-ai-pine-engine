// ================================================================
// BreakoutEx AI — Backtesting Types
// Reusable types for the Backtester engine.
// ================================================================

import { Candle } from '../config/types';
import { PineStrategyDefinition } from '../pine/strategy-library';
import { SignalDiagnostic } from './SignalDiagnostics';
import { BacktestValidationResult, ValidationIssue } from './BacktestValidator';
import { BacktestContext } from './BacktestContext';
import { PerformanceTiming } from './PerformanceTimer';

export type {
    SignalDiagnostic,
    BacktestValidationResult,
    ValidationIssue,
    BacktestContext,
    PerformanceTiming,
};

export type TradeSide = 'long' | 'short';

export type OrderAction = 'buy' | 'sell' | 'close';

export type BacktestStatus =
    | 'profitable'
    | 'neutral'
    | 'losing'
    | 'insufficient_sample'
    | 'no_triggers';

export type ExitReason =
    | 'tp'
    | 'sl'
    | 'trailing_sl'
    | 'reversal'
    | 'close_signal'
    | 'market_close';

export interface BacktestTrade {
    tradeNumber: number;

    side: TradeSide;

    entryTimestamp: number;
    exitTimestamp: number;

    entryPrice: number;
    exitPrice: number;

    entryBarIndex: number;
    exitBarIndex: number;

    barsHeld: number;

    grossPnlPercent: number;
    netPnlPercent: number;

    feePercent: number;
    slippagePercent: number;

    exitReason: ExitReason;

    maxRunUpPercent: number;
    maxDrawdownPercent: number;

    /**
     * Optional capital-based values.
     * These allow the engine to evolve from
     * percentage-only simulation to real
     * portfolio simulation.
     */
    quantity?: number;
    size?: number;
    grossPnl?: number;
    netPnl?: number;
    capitalBefore?: number;
    capitalAfter?: number;
}

export interface EquityPoint {
    timestamp: number;

    /**
     * Percentage return from initial capital.
     */
    equityPercent: number;

    /**
     * Absolute account equity when capital
     * simulation is enabled.
     */
    equity?: number;

    drawdownPercent: number;

    drawdown?: number;
}

export interface BacktestFees {
    /**
     * Percentage of notional.
     *
     * Example:
     * 0.04 = 0.04%
     */
    entryPct: number;
    exitPct: number;
    makerFeePercent?: number;
    takerFeePercent?: number;
}

export interface BacktestSlippage {
    /**
     * Percentage of fill price.
     *
     * Example:
     * 0.03 = 0.03%
     */
    entryPct: number;
    exitPct: number;
}

export type PositionSizingMode =
    | 'percentage'
    | 'fixed-capital'
    | 'fixed-risk';

export interface PositionSizingOptions {
    /**
     * percentage:
     * Uses a percentage of current equity.
     *
     * fixed-capital:
     * Uses the same capital amount every trade.
     *
     * fixed-risk:
     * Calculates quantity from risk-per-trade.
     */
    mode?: PositionSizingMode;

    /**
     * Percentage of equity used per trade.
     *
     * Example: 100 = entire account.
     */
    capitalPercent?: number;

    /**
     * Fixed amount of capital per trade.
     */
    fixedCapital?: number;

    /**
     * Risk percentage of account equity.
     *
     * Example: 1 = risk 1%.
     */
    riskPercent?: number;

    /**
     * Optional leverage.
     */
    leverage?: number;
}

export interface BacktestExecutionOptions {
    /**
     * false:
     * Signal on current candle -> next candle open.
     *
     * true:
     * Execute at current candle close.
     */
    processOrdersOnClose?: boolean;

    /**
     * Whether a new opposite signal reverses
     * the current position.
     */
    allowReversal?: boolean;

    /**
     * Maximum number of simultaneous positions.
     *
     * Current engine supports one position.
     */
    maxOpenPositions?: number;

    /**
     * Optional ATR trailing-stop multiplier.
     */
    trailingStopAtrMultiplier?: number;

    /**
     * Policy when both TP and SL are touched during the same bar.
     * Default: 'conservative' (assumes SL hit first).
     */
    sameBarExitPolicy?:
        | 'stop_first'
        | 'target_first'
        | 'nearest'
        | 'conservative';
}

export interface BacktestCapitalOptions {
    /**
     * Initial account capital.
     */
    initial: number;

    /**
     * Enable real capital accounting.
     *
     * Default: true.
     */
    enabled?: boolean;
}

export interface BacktestOptions {
    /**
     * Trading symbol.
     */
    symbol?: string;

    /**
     * Base timeframe used for execution.
     */
    baseTimeframe?: string;

    /**
     * Default take profit percent.
     */
    defaultTpPercent?: number;

    /**
     * Default stop loss percent.
     */
    defaultSlPercent?: number;

    /**
     * Number of candles used for actual
     * performance evaluation.
     *
     * Example:
     * 10,000 = evaluate the last 10,000 candles.
     */
    windowBars?: number;

    /**
     * Additional candles loaded before the
     * test period for indicator warmup.
     *
     * Example:
     * windowBars = 10,000
     * warmupBars = 2,000
     */
    warmupBars?: number;

    fees?: BacktestFees;
    slippage?: BacktestSlippage;

    execution?: BacktestExecutionOptions;

    capital?: BacktestCapitalOptions;

    positionSizing?: PositionSizingOptions;

    /**
     * Minimum number of completed trades before
     * calling a result statistically meaningful.
     */
    minSampleSize?: number;

    diagnostics?: {
        /**
         * Store Pine signal information.
         */
        collectSignals?: boolean;

        /**
         * Store only actionable signals.
         *
         * buy / sell / close
         */
        actionableOnly?: boolean;

        /**
         * Maximum number of diagnostic records.
         */
        maxSignalRecords?: number;
    };

    /**
     * Run BacktestValidator on the result before returning.
     * Default: true.
     */
    validateResult?: boolean;

    /**
     * Throw error if validation or execution fails.
     * Default: false.
     */
    strict?: boolean;

    /**
     * Microsecond performance tracking and optimization options.
     */
    performance?: {
        enabled?: boolean;
        usePrecomputedIndicators?: boolean;
        useCompiledScript?: boolean;
        zeroCopySnapshots?: boolean;
    };
}

export interface BacktestWindow {
    baseTimeframe: string;

    allCandles: Candle[];

    warmupCandles: Candle[];

    testCandles: Candle[];

    warmupStartTimestamp: number;

    testStartTimestamp: number;

    testEndTimestamp: number;

    warmupBars: number;

    testBars: number;
}

export interface BacktestRequest {
    strategy: PineStrategyDefinition;

    /**
     * Historical OHLCV data for all required timeframes.
     */
    candleMap: Map<string, Candle[]>;

    options?: BacktestOptions;

    /**
     * Optional pre-built context.
     *
     * Used by runMany() to avoid repeating
     * data preparation.
     */
    context?: BacktestContext;
}

export interface BacktestResult {
    strategyId: string;
    strategyName: string;
    symbol?: string;

    initialCapital: number;
    finalCapital: number;

    totalReturnPercent: number;

    totalTrades: number;

    wins: number;
    losses: number;
    breakevens: number;

    winRate: number;
    lossRate: number;

    profitFactor: number;

    netPnlPercent: number;

    netProfit: number;

    grossProfitPercent: number;
    grossLossPercent: number;

    maxDrawdownPercent: number;
    maxDrawdownBars: number;

    maxRunUpPercent: number;

    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;

    payoffRatio: number;

    expectancy: number;

    avgBarsHeld: number;

    maxConsecutiveWins: number;
    maxConsecutiveLosses: number;

    totalFeesPaidPercent: number;
    totalSlippagePaidPercent: number;

    status: BacktestStatus;

    trades: BacktestTrade[];

    equityCurve: EquityPoint[];

    signalDiagnostics?: SignalDiagnostic[];

    diagnostics: BacktestDiagnostics;

    performance?: PerformanceTiming;
}

export interface BacktestDiagnostics {
    insufficientData: boolean;

    requiredBaseCandles: number;

    availableBaseCandles: number;

    requiredDays: number;

    limitingFactor: string;

    executionErrors: number;

    signalErrors: number;

    lookaheadWarnings: number;

    /**
     * Total bars on which the Pine script was evaluated.
     */
    signalsEvaluated: number;

    /**
     * Total bars emitting buy or sell signals.
     */
    entrySignals: number;

    /**
     * Total bars emitting close signals.
     */
    exitSignals: number;

    /**
     * Total signals filtered by position state, sizing, or risk limits.
     */
    filteredSignals: number;

    /**
     * Total entry orders successfully executed into positions.
     */
    executedTrades: number;

    warmupBars: number;

    testBars: number;

    testStartTimestamp: number;

    testEndTimestamp: number;

    /**
     * Optional microsecond performance telemetry.
     */
    performance?: PerformanceTiming;
}

export interface ActivePosition {
    tradeNumber: number;

    side: TradeSide;

    entryTimestamp: number;
    entryPrice: number;
    rawEntryPrice: number;

    entryBarIndex: number;

    targetTp: number;
    targetSl: number;

    highestPrice: number;
    lowestPrice: number;

    quantity: number;

    /**
     * Account capital immediately before entry.
     */
    capitalBefore: number;

    /**
     * Notional value of the position.
     */
    notionalValue: number;

    /**
     * Actual entry commission paid.
     */
    entryFeeAmount: number;

    /**
     * Entry slippage in account currency.
     */
    entrySlippageAmount: number;

    /**
     * Entry fee as percentage.
     */
    entryFeePercent: number;

    /**
     * Entry slippage as percentage.
     */
    entrySlippagePercent: number;
}

export interface PendingOrder {
    action: 'buy' | 'sell';

    tp?: number;
    sl?: number;

    signalBarIndex: number;

    signalTimestamp: number;
}

export interface FillResult {
    rawPrice: number;

    fillPrice: number;

    quantity: number;

    notionalValue: number;

    feeAmount: number;

    slippageAmount: number;

    feePercent: number;

    slippagePercent: number;
}

export interface PositionCloseResult {
    trade: BacktestTrade;

    netPnlPercent: number;

    netPnl: number;

    capitalAfter: number;
}
