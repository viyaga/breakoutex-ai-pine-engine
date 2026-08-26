// ================================================================
// BreakoutEx AI — Pine Series Cache
//
// Precomputed OHLCV and derived price series.
//
// Important:
//   - Created once per candle/timeframe
//   - Never mutated during Pine execution
//   - O(1) indexed access
//   - Suitable for request.security() MTF execution
// ================================================================

import { Candle } from '../config/types';

export interface SeriesCache {
    readonly open: readonly number[];
    readonly high: readonly number[];
    readonly low: readonly number[];
    readonly close: readonly number[];
    readonly volume: readonly number[];
    readonly timestamp: readonly number[];

    readonly hl2: readonly number[];
    readonly hlc3: readonly number[];
    readonly ohlc4: readonly number[];

    readonly length: number;
}

export function createSeriesCache(
    candles: readonly Candle[]
): SeriesCache {
    const length = candles.length;

    const open = new Array<number>(length);
    const high = new Array<number>(length);
    const low = new Array<number>(length);
    const close = new Array<number>(length);
    const volume = new Array<number>(length);
    const timestamp = new Array<number>(length);

    const hl2 = new Array<number>(length);
    const hlc3 = new Array<number>(length);
    const ohlc4 = new Array<number>(length);

    for (let i = 0; i < length; i++) {
        const candle = candles[i];

        const o = Number(candle.open);
        const h = Number(candle.high);
        const l = Number(candle.low);
        const c = Number(candle.close);
        const v = Number(candle.volume);
        const t = Number(candle.timestamp);

        open[i] = o;
        high[i] = h;
        low[i] = l;
        close[i] = c;
        volume[i] = v;
        timestamp[i] = t;

        hl2[i] = (h + l) / 2;
        hlc3[i] = (h + l + c) / 3;
        ohlc4[i] = (o + h + l + c) / 4;
    }

    return {
        open,
        high,
        low,
        close,
        volume,
        timestamp,
        hl2,
        hlc3,
        ohlc4,
        length,
    };
}

// ================================================================
// Fast indexed access
// ================================================================

export function seriesValue(
    series: readonly number[],
    index: number
): number {
    if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= series.length
    ) {
        return NaN;
    }

    return series[index];
}

// ================================================================
// Pine historical indexing
//
// close[0] -> current bar
// close[1] -> previous bar
// close[2] -> two bars ago
// ================================================================

export function historicalSeriesValue(
    series: readonly number[],
    currentIndex: number,
    offset = 0
): number {
    if (
        !Number.isInteger(currentIndex) ||
        !Number.isInteger(offset)
    ) {
        return NaN;
    }

    const index = currentIndex - offset;

    return seriesValue(series, index);
}
