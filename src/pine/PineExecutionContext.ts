// ================================================================
// BreakoutEx AI — Pine Execution Context
//
// Supplies precomputed indicator data to the Pine interpreter.
//
// The interpreter remains responsible for Pine semantics.
// This context provides efficient O(1) historical indicator data access.
// ================================================================

import {
    IndicatorEngine,
} from '../backtesting/IndicatorEngine';

import {
    Candle,
} from '../config/types';

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
}
