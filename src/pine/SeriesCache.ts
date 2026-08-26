// ================================================================
// BreakoutEx AI — Series Cache
//
// Pre-allocated flat arrays for OHLCV, HL2, HLC3, OHLC4 series.
// Eliminates per-bar candles.map(...) allocations.
// ================================================================

import { Candle } from '../config/types';

export interface SeriesCache {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
    timestamp: number[];
    hl2: number[];
    hlc3: number[];
    ohlc4: number[];
}

export function createSeriesCache(candles: Candle[]): SeriesCache {
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
        const o = candle.open;
        const h = candle.high;
        const l = candle.low;
        const c = candle.close;
        open[i] = o;
        high[i] = h;
        low[i] = l;
        close[i] = c;
        volume[i] = candle.volume;
        timestamp[i] = candle.timestamp;
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
    };
}
