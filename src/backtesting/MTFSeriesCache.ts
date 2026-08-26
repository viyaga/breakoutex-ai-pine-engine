// ================================================================
// BreakoutEx AI — Multi-Timeframe Series Cache
//
// Canonical MTF market-data layer.
//
// Responsibilities:
//   - Aggregate base candles into requested timeframes (or accept pre-aggregated map)
//   - Maintain timestamp-based HTF mapping
//   - Provide O(1) base -> HTF lookup
//   - Provide HTF OHLCV/derived series
//   - Track HTF bar confirmation
//   - Provide lookahead/gaps mapping primitives
//
// IMPORTANT:
//   This class does NOT evaluate Pine expressions.
//   request.security() expression evaluation belongs to the
//   Pine interpreter/runtime.
//
// ================================================================

import { Candle } from '../config/types';
import {
    SeriesCache,
    createSeriesCache,
} from '../interpreter/SeriesCache';
import {
    IndicatorEngine,
} from './IndicatorEngine';
import {
    TimeframeCursor,
} from './TimeframeCursor';
import {
    CandleSeriesView,
} from '../interpreter/CandleSeriesView';
import {
    normalizeTimeframe,
    parseTimeframeToMinutes,
} from '../interpreter';

export const timeframeToMinutes = parseTimeframeToMinutes;

// ================================================================
// Types
// ================================================================

export type MTFGapMode =
    | 'gaps_off'
    | 'gaps_on';

export type MTFLookaheadMode =
    | 'off'
    | 'on';

export interface MTFBar {
    readonly index: number;

    readonly timestamp: number;

    readonly open: number;
    readonly high: number;
    readonly low: number;
    readonly close: number;
    readonly volume: number;

    readonly startTimestamp: number;
    readonly endTimestamp: number;

    /**
     * Number of base-timeframe candles represented by this HTF bar.
     */
    readonly baseBarCount: number;

    /**
     * True when the HTF interval is complete relative to the
     * available historical base candles.
     */
    readonly confirmed: boolean;
}

export interface MTFMappingOptions {
    lookahead?: MTFLookaheadMode;
    gaps?: MTFGapMode;
}

export interface MTFSeriesContext {
    readonly timeframe: string;
    readonly timeframeMinutes: number;
    readonly candles: readonly Candle[];
    readonly bars: readonly MTFBar[];
    readonly indicators: IndicatorEngine;
    readonly cursor: TimeframeCursor;
    readonly series: SeriesCache;
    readonly view: CandleSeriesView;
    readonly baseToHTF: readonly number[];
    readonly baseConfirmed: readonly boolean[];
    readonly htfFirstBaseIndex: readonly number[];
    readonly htfLastBaseIndex: readonly number[];
}

export type MTFSeries = MTFSeriesContext;

// ================================================================
// Calendar bucketing
// ================================================================

function getBucketStart(
    timestamp: number,
    timeframeMinutes: number
): number {
    const interval =
        timeframeMinutes *
        60_000;

    return (
        Math.floor(
            timestamp / interval
        ) * interval
    );
}

// ================================================================
// MTFSeriesCache
// ================================================================

export class MTFSeriesCache {

    private readonly cache =
        new Map<string, MTFSeriesContext>();

    private readonly baseCandles: readonly Candle[];

    private readonly baseTimeframe: string;

    private readonly baseTimeframeMinutes: number;

    constructor(
        input: Candle[] | readonly Candle[] | Map<string, Candle[]> | Map<string, readonly Candle[]>,
        baseTimeframe = '5m'
    ) {
        if (input instanceof Map) {
            // Map input: find base candles or use first entry
            const normBase = normalizeTimeframe(baseTimeframe);
            const foundBase = input.get(normBase) ?? input.get(baseTimeframe) ?? input.values().next().value;
            this.baseCandles = foundBase ?? [];
            this.baseTimeframe = normBase;
            this.baseTimeframeMinutes = timeframeToMinutes(normBase);

            // Pre-populate explicitly provided timeframe series
            for (const [rawTf, candles] of input.entries()) {
                const tf = normalizeTimeframe(rawTf);
                const tfMinutes = timeframeToMinutes(tf);
                const candleList = candles as Candle[];
                const bars = this.createBarsFromCandles(candleList, tfMinutes);
                this.cache.set(tf, {
                    timeframe: tf,
                    timeframeMinutes: tfMinutes,
                    candles: candleList,
                    bars,
                    indicators: new IndicatorEngine(candleList),
                    cursor: new TimeframeCursor(candleList),
                    series: createSeriesCache(candleList),
                    view: new CandleSeriesView(candleList),
                    baseToHTF: [],
                    baseConfirmed: [],
                    htfFirstBaseIndex: [],
                    htfLastBaseIndex: [],
                });
            }
        } else {
            this.baseCandles = input;
            this.baseTimeframe = normalizeTimeframe(baseTimeframe);
            this.baseTimeframeMinutes = timeframeToMinutes(baseTimeframe);
        }
    }

    // ============================================================
    // Public metadata
    // ============================================================

    getBaseTimeframe(): string {
        return this.baseTimeframe;
    }

    getBaseTimeframeMinutes(): number {
        return this.baseTimeframeMinutes;
    }

    getBaseCandles(): readonly Candle[] {
        return this.baseCandles;
    }

    // ============================================================
    // Get / build timeframe
    // ============================================================

    get(
        timeframe: string | number
    ): MTFSeriesContext | undefined {
        const normalized =
            normalizeTimeframe(
                timeframe
            );

        const existing =
            this.cache.get(
                normalized
            );

        if (existing) {
            return existing;
        }

        if (this.baseCandles.length === 0) {
            return undefined;
        }

        const built =
            this.build(
                normalized
            );

        this.cache.set(
            normalized,
            built
        );

        return built;
    }

    has(
        timeframe: string | number
    ): boolean {
        return this.cache.has(
            normalizeTimeframe(
                timeframe
            )
        );
    }

    timeframes(): string[] {
        return Array.from(this.cache.keys());
    }

    advance(
        timeframe: string,
        timestamp: number
    ): number {
        const context =
            this.get(timeframe);

        if (!context) {
            return -1;
        }

        return context.cursor.advanceTo(
            timestamp
        );
    }

    reset(): void {
        for (const context of this.cache.values()) {
            context.cursor.reset();
        }
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }

    // ============================================================
    // Build
    // ============================================================

    private build(
        timeframe: string
    ): MTFSeriesContext {
        const timeframeMinutes =
            timeframeToMinutes(
                timeframe
            );

        if (
            timeframeMinutes ===
            this.baseTimeframeMinutes
        ) {
            return this.buildBaseSeries(
                timeframe,
                timeframeMinutes
            );
        }

        if (
            timeframeMinutes <
            this.baseTimeframeMinutes
        ) {
            throw new Error(
                `Cannot build lower timeframe ${timeframe} ` +
                `from base timeframe ${this.baseTimeframe}. ` +
                `Use request.security_lower_tf() with appropriate ` +
                `lower-timeframe data.`
            );
        }

        return this.aggregate(
            timeframe,
            timeframeMinutes
        );
    }

    // ============================================================
    // Base timeframe
    // ============================================================

    private buildBaseSeries(
        timeframe: string,
        timeframeMinutes: number
    ): MTFSeriesContext {
        const candles =
            this.baseCandles.slice() as Candle[];

        const bars =
            new Array<MTFBar>(
                candles.length
            );

        const baseToHTF =
            new Array<number>(
                candles.length
            );

        const baseConfirmed =
            new Array<boolean>(
                candles.length
            );

        const firstBase =
            new Array<number>(
                candles.length
            );

        const lastBase =
            new Array<number>(
                candles.length
            );

        const interval =
            timeframeMinutes *
            60_000;

        for (
            let i = 0;
            i < candles.length;
            i++
        ) {
            const candle =
                candles[i];

            bars[i] = {
                index: i,

                timestamp:
                    candle.timestamp,

                open:
                    candle.open,

                high:
                    candle.high,

                low:
                    candle.low,

                close:
                    candle.close,

                volume:
                    candle.volume,

                startTimestamp:
                    candle.timestamp,

                endTimestamp:
                    candle.timestamp +
                    interval,

                baseBarCount: 1,

                confirmed: true,
            };

            baseToHTF[i] = i;
            baseConfirmed[i] = true;

            firstBase[i] = i;
            lastBase[i] = i;
        }

        return {
            timeframe,
            timeframeMinutes,
            candles,
            bars,
            indicators: new IndicatorEngine(candles),
            cursor: new TimeframeCursor(candles),
            series:
                createSeriesCache(
                    candles
                ),
            view:
                new CandleSeriesView(
                    candles
                ),
            baseToHTF,
            baseConfirmed,
            htfFirstBaseIndex:
                firstBase,
            htfLastBaseIndex:
                lastBase,
        };
    }

    // ============================================================
    // HTF aggregation
    // ============================================================

    private aggregate(
        timeframe: string,
        timeframeMinutes: number
    ): MTFSeriesContext {
        const interval =
            timeframeMinutes *
            60_000;

        const bars: MTFBar[] = [];

        const candles: Candle[] = [];

        const baseToHTF =
            new Array<number>(
                this.baseCandles.length
            ).fill(-1);

        const baseConfirmed =
            new Array<boolean>(
                this.baseCandles.length
            ).fill(false);

        const firstBaseIndex: number[] = [];

        const lastBaseIndex: number[] = [];

        let currentBucket =
            -1;

        let currentOpen = 0;
        let currentHigh = -Infinity;
        let currentLow = Infinity;
        let currentClose = 0;
        let currentVolume = 0;

        let currentFirstBase = -1;
        let currentLastBase = -1;

        const flush =
            () => {
                if (
                    currentBucket < 0 ||
                    currentFirstBase < 0
                ) {
                    return;
                }

                const index =
                    bars.length;

                const confirmed =
                    currentLastBase <
                    this.baseCandles.length - 1;

                const candle: Candle = {
                    timestamp:
                        currentBucket,

                    open:
                        currentOpen,

                    high:
                        currentHigh,

                    low:
                        currentLow,

                    close:
                        currentClose,

                    volume:
                        currentVolume,
                };

                candles.push(
                    candle
                );

                bars.push({
                    index,

                    timestamp:
                        currentBucket,

                    open:
                        currentOpen,

                    high:
                        currentHigh,

                    low:
                        currentLow,

                    close:
                        currentClose,

                    volume:
                        currentVolume,

                    startTimestamp:
                        currentBucket,

                    endTimestamp:
                        currentBucket +
                        interval,

                    baseBarCount:
                        currentLastBase -
                        currentFirstBase +
                        1,

                    confirmed,
                });

                firstBaseIndex[index] =
                    currentFirstBase;

                lastBaseIndex[index] =
                    currentLastBase;

                currentBucket = -1;
            };

        for (
            let i = 0;
            i < this.baseCandles.length;
            i++
        ) {
            const candle =
                this.baseCandles[i];

            const bucket =
                getBucketStart(
                    candle.timestamp,
                    timeframeMinutes
                );

            if (
                currentBucket < 0
            ) {
                currentBucket =
                    bucket;

                currentOpen =
                    candle.open;

                currentHigh =
                    candle.high;

                currentLow =
                    candle.low;

                currentClose =
                    candle.close;

                currentVolume =
                    candle.volume;

                currentFirstBase =
                    i;

                currentLastBase =
                    i;

                continue;
            }

            if (
                bucket !==
                currentBucket
            ) {
                flush();

                currentBucket =
                    bucket;

                currentOpen =
                    candle.open;

                currentHigh =
                    candle.high;

                currentLow =
                    candle.low;

                currentClose =
                    candle.close;

                currentVolume =
                    candle.volume;

                currentFirstBase =
                    i;

                currentLastBase =
                    i;

                continue;
            }

            currentHigh =
                Math.max(
                    currentHigh,
                    candle.high
                );

            currentLow =
                Math.min(
                    currentLow,
                    candle.low
                );

            currentClose =
                candle.close;

            currentVolume +=
                candle.volume;

            currentLastBase =
                i;
        }

        flush();

        for (
            let htfIndex = 0;
            htfIndex < bars.length;
            htfIndex++
        ) {
            const first =
                firstBaseIndex[
                    htfIndex
                ];

            const last =
                lastBaseIndex[
                    htfIndex
                ];

            const isLastHTF =
                htfIndex === bars.length - 1;

            for (
                let baseIndex =
                    first;
                baseIndex <= last;
                baseIndex++
            ) {
                baseToHTF[
                    baseIndex
                ] = htfIndex;

                // An HTF bar is only confirmed when its closing base bar is reached
                baseConfirmed[
                    baseIndex
                ] = (baseIndex === last);
            }
        }

        return {
            timeframe,
            timeframeMinutes,

            candles,

            bars,

            indicators:
                new IndicatorEngine(
                    candles
                ),

            cursor:
                new TimeframeCursor(
                    candles
                ),

            series:
                createSeriesCache(
                    candles
                ),

            view:
                new CandleSeriesView(
                    candles
                ),

            baseToHTF,

            baseConfirmed,

            htfFirstBaseIndex:
                firstBaseIndex,

            htfLastBaseIndex:
                lastBaseIndex,
        };
    }

    private createBarsFromCandles(
        candles: Candle[],
        timeframeMinutes: number
    ): MTFBar[] {
        const interval = timeframeMinutes * 60_000;
        return candles.map((c, i) => ({
            index: i,
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            startTimestamp: c.timestamp,
            endTimestamp: c.timestamp + interval,
            baseBarCount: 1,
            confirmed: true,
        }));
    }

    // ============================================================
    // Base → HTF index
    // ============================================================

    getHTFIndex(
        timeframe: string | number,
        baseIndex: number
    ): number {
        const mtf =
            this.get(timeframe);

        if (
            !mtf ||
            baseIndex < 0 ||
            baseIndex >=
                mtf.baseToHTF.length
        ) {
            return -1;
        }

        return mtf.baseToHTF[
            baseIndex
        ];
    }

    // ============================================================
    // HTF confirmation
    // ============================================================

    isHTFConfirmed(
        timeframe: string | number,
        baseIndex: number
    ): boolean {
        const mtf =
            this.get(timeframe);

        if (
            !mtf ||
            baseIndex < 0 ||
            baseIndex >=
                mtf.baseConfirmed.length
        ) {
            return false;
        }

        return mtf.baseConfirmed[
            baseIndex
        ];
    }

    // ============================================================
    // Pine request.security() mapping
    // ============================================================

    getMappedHTFIndex(
        timeframe: string | number,
        baseIndex: number,
        options: MTFMappingOptions = {}
    ): number {
        const mtf =
            this.get(timeframe);

        if (
            !mtf ||
            baseIndex < 0 ||
            baseIndex >=
                this.baseCandles.length
        ) {
            return -1;
        }

        const lookahead =
            options.lookahead ??
            'off';

        const gaps =
            options.gaps ??
            'gaps_off';

        let htfIndex =
            mtf.baseToHTF[
                baseIndex
            ];

        if (htfIndex < 0) {
            return -1;
        }

        if (
            lookahead === 'off'
        ) {
            if (
                !mtf.baseConfirmed[
                    baseIndex
                ]
            ) {
                htfIndex -= 1;
            }
        }

        if (
            gaps === 'gaps_on' &&
            !mtf.baseConfirmed[
                baseIndex
            ]
        ) {
            return -1;
        }

        if (
            htfIndex < 0 ||
            htfIndex >=
                mtf.bars.length
        ) {
            return -1;
        }

        return htfIndex;
    }

    // ============================================================
    // Map a single HTF series value to a base bar
    // ============================================================

    mapValue<T>(
        timeframe: string | number,
        values: readonly T[],
        baseIndex: number,
        options: MTFMappingOptions = {}
    ): T | undefined {
        const mtfIndex =
            this.getMappedHTFIndex(
                timeframe,
                baseIndex,
                options
            );

        if (
            mtfIndex < 0 ||
            mtfIndex >=
                values.length
        ) {
            return undefined;
        }

        return values[
            mtfIndex
        ];
    }

    // ============================================================
    // Map complete HTF series to base timeframe
    // ============================================================

    mapSeries<T>(
        timeframe: string | number,
        values: readonly T[],
        options: MTFMappingOptions = {}
    ): Array<T | undefined> {
        const result =
            new Array<T | undefined>(
                this.baseCandles.length
            );

        let previous:
            | T
            | undefined;

        for (
            let baseIndex = 0;
            baseIndex <
                this.baseCandles.length;
            baseIndex++
        ) {
            const mapped =
                this.mapValue(
                    timeframe,
                    values,
                    baseIndex,
                    options
                );

            if (
                mapped !== undefined
            ) {
                previous =
                    mapped;

                result[baseIndex] =
                    mapped;

                continue;
            }

            if (
                (
                    options.gaps ??
                    'gaps_off'
                ) === 'gaps_off'
            ) {
                result[baseIndex] =
                    previous;
            } else {
                result[baseIndex] =
                    undefined;
            }
        }

        return result;
    }

    // ============================================================
    // Diagnostics
    // ============================================================

    stats(): {
        cachedTimeframes: number;
        baseBars: number;
        totalHTFBars: number;
        timeframes: string[];
    } {
        let totalHTFBars = 0;

        for (
            const mtf of
            this.cache.values()
        ) {
            totalHTFBars +=
                mtf.bars.length;
        }

        return {
            cachedTimeframes:
                this.cache.size,

            baseBars:
                this.baseCandles.length,

            totalHTFBars,

            timeframes:
                Array.from(
                    this.cache.keys()
                ),
        };
    }
}
