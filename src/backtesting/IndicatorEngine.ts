// ================================================================
// BreakoutEx AI — Precomputed Indicator Engine
//
// Calculates complete indicator series over a full candle array.
// Results are cached by indicator name and period for O(1) bar lookups.
//
// Math is canonical to `src/interpreter/indicators.ts` with zero divergence.
// Integrated with SeriesCache for zero-copy OHLCV/derived price series access.
// ================================================================

import { Candle } from '../config/types';
import * as Ind from '../interpreter';
import { SeriesCache, createSeriesCache } from '../interpreter';

export class IndicatorEngine {

    private readonly numCache = new Map<string, number[]>();
    private readonly objCache = new Map<string, any>();
    private readonly seriesCache: SeriesCache;

    constructor(
        private readonly candles: Candle[]
    ) {
        this.seriesCache = createSeriesCache(candles);
    }

    // ============================================================
    // Direct Series Cache Access
    // ============================================================

    get series(): SeriesCache {
        return this.seriesCache;
    }

    get length(): number {
        return this.seriesCache.length;
    }

    close(): readonly number[] {
        return this.seriesCache.close;
    }

    open(): readonly number[] {
        return this.seriesCache.open;
    }

    high(): readonly number[] {
        return this.seriesCache.high;
    }

    low(): readonly number[] {
        return this.seriesCache.low;
    }

    volume(): readonly number[] {
        return this.seriesCache.volume;
    }

    hl2(): readonly number[] {
        return this.seriesCache.hl2;
    }

    hlc3(): readonly number[] {
        return this.seriesCache.hlc3;
    }

    ohlc4(): readonly number[] {
        return this.seriesCache.ohlc4;
    }

    // ============================================================
    // Cache Management & Diagnostics
    // ============================================================

    clearCache(): void {
        this.numCache.clear();
        this.objCache.clear();
    }

    has(key: string): boolean {
        return this.numCache.has(key) || this.objCache.has(key);
    }

    size(): number {
        return this.numCache.size + this.objCache.size;
    }

    stats(): { numCached: number; objCached: number; totalCached: number; seriesLength: number } {
        return {
            numCached: this.numCache.size,
            objCached: this.objCache.size,
            totalCached: this.size(),
            seriesLength: this.seriesCache.length,
        };
    }

    // ============================================================
    // Moving Averages
    // ============================================================

    ema(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): number[] {
        const src = this.getSourceSeries(source);
        return this.getOrCalculateNum(
            `ema:${period}:${source}`,
            () => Ind.ema(src, period)
        );
    }

    sma(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): number[] {
        const src = this.getSourceSeries(source);
        return this.getOrCalculateNum(
            `sma:${period}:${source}`,
            () => Ind.sma(src, period)
        );
    }

    wma(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): number[] {
        const src = this.getSourceSeries(source);
        return this.getOrCalculateNum(
            `wma:${period}:${source}`,
            () => Ind.wma(src, period)
        );
    }

    hma(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): number[] {
        const src = this.getSourceSeries(source);
        return this.getOrCalculateNum(
            `hma:${period}:${source}`,
            () => Ind.hma(src, period)
        );
    }

    dema(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): number[] {
        const src = this.getSourceSeries(source);
        return this.getOrCalculateNum(
            `dema:${period}:${source}`,
            () => Ind.dema(src, period)
        );
    }

    tema(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): number[] {
        const src = this.getSourceSeries(source);
        return this.getOrCalculateNum(
            `tema:${period}:${source}`,
            () => Ind.tema(src, period)
        );
    }

    rma(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): number[] {
        const src = this.getSourceSeries(source);
        return this.getOrCalculateNum(
            `rma:${period}:${source}`,
            () => Ind.rma(src, period)
        );
    }

    // ============================================================
    // Momentum & Volatility Indicators
    // ============================================================

    rsi(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): number[] {
        const src = this.getSourceSeries(source);
        return this.getOrCalculateNum(
            `rsi:${period}:${source}`,
            () => Ind.rsi(src, period)
        );
    }

    atr(period: number): number[] {
        return this.getOrCalculateNum(
            `atr:${period}`,
            () => Ind.atr(this.candles, period)
        );
    }

    cci(period = 20): number[] {
        return this.getOrCalculateNum(
            `cci:${period}`,
            () => Ind.cci(this.candles, period)
        );
    }

    bbands(
        period = 20,
        mult = 2,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): { middle: number[]; upper: number[]; lower: number[]; width: number[]; percentB: number[] } {
        return this.getOrCalculateObj(
            `bbands:${period}:${mult}:${source}`,
            () => Ind.bbands(this.getSourceSeries(source), period, mult)
        );
    }

    donchian(period = 20): { upper: number[]; lower: number[]; middle: number[] } {
        return this.getOrCalculateObj(
            `donchian:${period}`,
            () => Ind.donchian(this.candles, period)
        );
    }

    keltner(
        period = 20,
        mult = 1.5,
        atrPeriod = 10
    ): { upper: number[]; lower: number[]; middle: number[] } {
        return this.getOrCalculateObj(
            `keltner:${period}:${mult}:${atrPeriod}`,
            () => Ind.keltner(this.candles, period, mult, atrPeriod)
        );
    }

    macd(
        fast = 12,
        slow = 26,
        signal = 9,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
        return this.getOrCalculateObj(
            `macd:${fast}:${slow}:${signal}:${source}`,
            () => Ind.macd(this.getSourceSeries(source), fast, slow, signal)
        );
    }

    supertrend(
        factor = 3,
        period = 10
    ): { supertrend: number[]; direction: number[] } {
        return this.getOrCalculateObj(
            `supertrend:${factor}:${period}`,
            () => Ind.supertrend(this.candles, period, factor)
        );
    }

    stoch(period = 14): number[] {
        return this.getOrCalculateNum(
            `stoch:${period}`,
            () => Ind.stoch(this.high(), this.low(), this.close(), period)
        );
    }

    stochRsi(
        rsiPeriod = 14,
        stochPeriod = 14,
        k = 3,
        d = 3,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'close'
    ): { k: number[]; d: number[] } {
        return this.getOrCalculateObj(
            `stochRsi:${rsiPeriod}:${stochPeriod}:${k}:${d}:${source}`,
            () => Ind.stochRsi(this.getSourceSeries(source), rsiPeriod, stochPeriod, k, d)
        );
    }

    mfi(period = 14): number[] {
        return this.getOrCalculateNum(
            `mfi:${period}`,
            () => Ind.mfi(this.candles, period)
        );
    }

    adx(period = 14): { adx: number[]; diPlus: number[]; diMinus: number[] } {
        return this.getOrCalculateObj(
            `adx:${period}`,
            () => Ind.adx(this.candles, period)
        );
    }

    highest(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'high'
    ): number[] {
        const src = this.getSourceSeries(source);
        return this.getOrCalculateNum(
            `highest:${period}:${source}`,
            () => Ind.highest(src, period)
        );
    }

    lowest(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' = 'low'
    ): number[] {
        const src = this.getSourceSeries(source);
        return this.getOrCalculateNum(
            `lowest:${period}:${source}`,
            () => Ind.lowest(src, period)
        );
    }

    vwap(): number[] {
        return this.getOrCalculateNum(
            'vwap',
            () => Ind.vwap(this.candles)
        );
    }

    // ============================================================
    // Private Helpers
    // ============================================================

    private getSourceSeries(source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4'): readonly number[] {
        switch (source) {
            case 'open':
                return this.open();
            case 'high':
                return this.high();
            case 'low':
                return this.low();
            case 'hl2':
                return this.hl2();
            case 'hlc3':
                return this.hlc3();
            case 'ohlc4':
                return this.ohlc4();
            case 'close':
            default:
                return this.close();
        }
    }

    private getOrCalculateNum(
        key: string,
        calculate: () => number[]
    ): number[] {
        const existing = this.numCache.get(key);
        if (existing) {
            return existing;
        }
        const values = calculate();
        this.numCache.set(key, values);
        return values;
    }

    private getOrCalculateObj<T>(
        key: string,
        calculate: () => T
    ): T {
        const existing = this.objCache.get(key);
        if (existing) {
            return existing;
        }
        const values = calculate();
        this.objCache.set(key, values);
        return values;
    }
}
