// ================================================================
// BreakoutEx AI — Pine Execution Context
//
// Supplies precomputed indicator data and flat series to the Pine interpreter.
//
// The interpreter remains responsible for Pine semantics.
// This context provides efficient O(1) historical indicator and series access.
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

export interface PineExecutionContext {

    /**
     * Current bar index in the base timeframe (full history index).
     */
    currentBarIndex: number;

    /**
     * Index where the actual test period begins.
     */
    testStartIndex: number;

    /**
     * Current timestamp.
     */
    currentTimestamp: number;

    /**
     * Base timeframe candles (full history).
     */
    candles: Candle[];

    /**
     * Precomputed indicators for base timeframe.
     */
    indicators: IndicatorEngine;

    /**
     * Optional MTF indicator engines.
     * Key = normalized timeframe ('5m', '15m', '1h', '4h', '1d').
     */
    timeframeIndicators?: Map<string, IndicatorEngine>;

    /**
     * Pre-allocated flat OHLCV series caches per timeframe.
     */
    series?: Map<string, SeriesCache>;

    /**
     * MTF cursors tracking current visible HTF bar index.
     */
    cursors?: Map<string, TimeframeCursor>;

    /**
     * Unified MTF Series & Indicator cache.
     */
    mtfCache?: MTFSeriesCache;
}
