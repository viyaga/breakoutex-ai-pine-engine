// ================================================================
// BreakoutEx AI — Pine Execution Context
//
// Runtime state supplied to Pine execution.
//
// The context deliberately separates:
//
//   1. immutable market data
//   2. precomputed indicators
//   3. MTF state
//   4. Pine execution state
//
// This prevents the interpreter from mixing market data with
// strategy state.
// ================================================================

import {
    IndicatorEngine,
} from '../backtesting/IndicatorEngine';

import {
    Candle,
} from '../config/types';

import {
    SeriesCache,
} from './SeriesCache';

import {
    TimeframeCursor,
} from '../backtesting/TimeframeCursor';

import {
    MTFSeriesCache,
} from '../backtesting/MTFSeriesCache';

import {
    PineOrderEngine,
} from '../backtesting/PineOrderEngine';

// ================================================================
// Position
// ================================================================

export type PinePositionDirection =
    | 'long'
    | 'short'
    | 'none';

// ================================================================
// Strategy state
// ================================================================

export interface PineStrategyState {
    positionDirection: PinePositionDirection;

    positionSize: number;

    averagePrice: number;

    opentrades: number;

    closedtrades: number;

    netProfit: number;

    equity: number;

    initialCapital: number;
}

// ================================================================
// Bar state
// ================================================================

export interface PineBarState {
    barIndex: number;

    firstBar: boolean;

    lastBar: boolean;

    isHistory: boolean;

    isRealtime: boolean;

    isConfirmed: boolean;

    timestamp: number;
}

// ================================================================
// Pine variable state
// ================================================================
//
// Used by var / varip style persistent variables.
//
// The interpreter may store values here between bars.
//

export type PineVariableValue =
    | number
    | boolean
    | string
    | null
    | undefined
    | PineVariableValue[]
    | Record<string, unknown>;

export interface PineVariableState {
    readonly values: Map<string, PineVariableValue>;

    readonly initialized: Set<string>;
}

// ================================================================
// Execution context
// ================================================================

export interface PineExecutionContext {

    // ============================================================
    // Current execution
    // ============================================================

    /**
     * Current bar index in the complete base-timeframe history.
     */
    currentBarIndex: number;

    /**
     * First bar used by the actual test/evaluation period.
     */
    testStartIndex: number;

    /**
     * Current candle timestamp.
     */
    currentTimestamp: number;

    /**
     * Base timeframe.
     */
    baseTimeframe?: string;

    // ============================================================
    // Base market data
    // ============================================================

    /**
     * Complete base timeframe history.
     */
    candles: Candle[];

    /**
     * O(1) OHLCV series.
     */
    series?: Map<string, SeriesCache>;

    // ============================================================
    // Indicators
    // ============================================================

    /**
     * Precomputed indicators for base timeframe.
     */
    indicators: IndicatorEngine;

    /**
     * Precomputed indicator engines for HTF data.
     *
     * Key:
     *
     *   "15m"
     *   "1h"
     *   "4h"
     */
    timeframeIndicators?: Map<
        string,
        IndicatorEngine
    >;

    // ============================================================
    // MTF
    // ============================================================

    /**
     * Current HTF cursor per timeframe.
     */
    cursors?: Map<
        string,
        TimeframeCursor
    >;

    /**
     * Unified MTF cache.
     */
    mtfCache?: MTFSeriesCache;

    // ============================================================
    // Pine runtime state
    // ============================================================

    /**
     * Persistent Pine variables.
     */
    variables?: PineVariableState;

    /**
     * Current strategy state.
     */
    strategy?: PineStrategyState;

    /**
     * Optional Pine order engine managing orders, fills, and position lifecycle.
     */
    orderEngine?: PineOrderEngine;

    /**
     * Current bar state.
     */
    barState?: PineBarState;
}

// ================================================================
// Factory helpers
// ================================================================

export function createPineVariableState(): PineVariableState {
    return {
        values: new Map(),
        initialized: new Set(),
    };
}

export function createPineStrategyState(
    initialCapital = 100000
): PineStrategyState {
    return {
        positionDirection: 'none',
        positionSize: 0,
        averagePrice: 0,
        opentrades: 0,
        closedtrades: 0,
        netProfit: 0,
        equity: initialCapital,
        initialCapital,
    };
}

export function createPineBarState(
    barIndex: number,
    totalBars: number,
    timestamp: number,
    isRealtime = false
): PineBarState {
    return {
        barIndex,

        firstBar: barIndex === 0,

        lastBar:
            barIndex === totalBars - 1,

        isHistory: !isRealtime,

        isRealtime,

        isConfirmed: !isRealtime,

        timestamp,
    };
}
