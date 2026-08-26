// ================================================================
// BreakoutEx AI — Shared Backtest Context
//
// Prepared once and reused across multiple strategies.
//
// Pre-normalizes, validates, sorts, and indexes candle series
// and multi-timeframe cursors for zero-copy execution.
// ================================================================

import { Candle } from '../config/types';
import { normalizeTimeframe } from '../pine/interpreter';
import { SeriesCache, createSeriesCache } from '../pine/SeriesCache';
import { TimeframeCursor } from './TimeframeCursor';
import { MTFSeriesCache } from './MTFSeriesCache';

export interface BacktestContext {

    candleMap: Map<string, Candle[]>;

    series: Map<string, SeriesCache>;

    cursors: Map<string, TimeframeCursor>;

    mtf: MTFSeriesCache;

    timeframes: string[];

    baseTimeframe: string;

    baseCandles: Candle[];

    startTimestamp: number;

    endTimestamp: number;
}

export function createBacktestContext(
    candleMap: Map<string, Candle[]>,
    baseTimeframe: string
): BacktestContext {

    const normalizedMap =
        new Map<string, Candle[]>();

    for (
        const [rawTimeframe, candles]
        of candleMap.entries()
    ) {

        const timeframe =
            normalizeTimeframe(
                rawTimeframe
            );

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
            .sort(
                (a, b) =>
                    a.timestamp -
                    b.timestamp
            );

        if (clean.length > 0) {
            normalizedMap.set(
                timeframe,
                clean
            );
        }
    }

    const normalizedBaseTimeframe =
        normalizeTimeframe(
            baseTimeframe
        );

    const baseCandles =
        normalizedMap.get(
            normalizedBaseTimeframe
        ) ?? [];

    if (
        baseCandles.length === 0
    ) {

        throw new Error(
            `[BACKTEST_NO_BASE_DATA] ` +
            `No candles found for ` +
            `${normalizedBaseTimeframe}.`
        );
    }

    const series = new Map<string, SeriesCache>();
    const cursors = new Map<string, TimeframeCursor>();

    for (const [timeframe, candles] of normalizedMap.entries()) {
        series.set(timeframe, createSeriesCache(candles));
        cursors.set(timeframe, new TimeframeCursor(candles));
    }

    const mtf = new MTFSeriesCache(normalizedMap);

    return {

        candleMap:
            normalizedMap,

        series,

        cursors,

        mtf,

        timeframes:
            Array.from(
                normalizedMap.keys()
            ),

        baseTimeframe:
            normalizedBaseTimeframe,

        baseCandles,

        startTimestamp:
            baseCandles[0].timestamp,

        endTimestamp:
            baseCandles[
                baseCandles.length - 1
            ].timestamp,
    };
}
