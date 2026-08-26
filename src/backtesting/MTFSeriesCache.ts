// ================================================================
// BreakoutEx AI — MTF Series Cache
//
// Provides precomputed higher-timeframe series to
// request.security() without filtering/slicing candles
// on every base-timeframe bar.
// ================================================================

import {
    Candle,
} from '../config/types';

import {
    IndicatorEngine,
} from './IndicatorEngine';

import {
    TimeframeCursor,
} from './TimeframeCursor';

import {
    SeriesCache,
    createSeriesCache,
    normalizeTimeframe,
} from '../interpreter';

export interface MTFSeriesContext {

    timeframe: string;

    candles: Candle[];

    indicators: IndicatorEngine;

    cursor: TimeframeCursor;

    series: SeriesCache;
}

export class MTFSeriesCache {

    private readonly contexts =
        new Map<string, MTFSeriesContext>();

    constructor(
        candleMap: Map<string, Candle[]>
    ) {

        for (
            const [
                rawTf,
                candles
            ]
            of candleMap.entries()
        ) {

            const timeframe =
                normalizeTimeframe(rawTf);

            this.contexts.set(
                timeframe,
                {
                    timeframe,

                    candles,

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
                }
            );
        }
    }

    get(
        timeframe: string
    ):
        MTFSeriesContext | undefined {

        return this.contexts.get(
            normalizeTimeframe(timeframe)
        );
    }

    advance(
        timeframe: string,
        timestamp: number
    ): number {

        const context =
            this.get(timeframe);

        if (
            !context
        ) {

            return -1;
        }

        return context.cursor.advanceTo(
            timestamp
        );
    }

    reset(): void {

        for (const context of this.contexts.values()) {
            context.cursor.reset();
        }
    }

    clear(): void {

        this.contexts.clear();
    }
}
