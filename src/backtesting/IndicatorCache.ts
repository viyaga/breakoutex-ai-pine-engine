// ================================================================
// BreakoutEx AI — Indicator Cache
//
// Caches indicator series for a specific candle dataset.
//
// IMPORTANT:
// The cache key includes:
//   - timeframe
//   - indicator
//   - period
//   - source series
//
// Never cache across different candle datasets.
// ================================================================

import { Candle } from '../config/types';

export interface IndicatorCacheKey {
    timeframe: string;
    indicator: string;
    period: number;
    source: string;
}

export class IndicatorCache {

    private readonly cache =
        new Map<string, number[]>();

    private readonly candles =
        new Map<string, Candle[]>();

    setCandles(
        timeframe: string,
        candles: Candle[]
    ): void {

        this.candles.set(
            timeframe,
            candles
        );
    }

    getCandles(
        timeframe: string
    ): Candle[] | undefined {

        return this.candles.get(
            timeframe
        );
    }

    get(
        key: IndicatorCacheKey
    ): number[] | undefined {

        return this.cache.get(
            IndicatorCache.makeKey(key)
        );
    }

    set(
        key: IndicatorCacheKey,
        values: number[]
    ): void {

        this.cache.set(
            IndicatorCache.makeKey(key),
            values
        );
    }

    has(
        key: IndicatorCacheKey
    ): boolean {

        return this.cache.has(
            IndicatorCache.makeKey(key)
        );
    }

    clear(): void {

        this.cache.clear();
        this.candles.clear();
    }

    size(): number {

        return this.cache.size;
    }

    private static makeKey(
        key: IndicatorCacheKey
    ): string {

        return [
            key.timeframe,
            key.indicator,
            key.period,
            key.source,
        ].join('|');
    }
}
