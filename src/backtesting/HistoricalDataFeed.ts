// ================================================================
// BreakoutEx AI — Historical Data Feed
//
// Reusable historical + MTF data provider for Backtester.
//
// Responsibilities:
// - Normalize timeframe keys
// - Validate/sort candle data
// - Detect requested MTF timeframes
// - Provide zero-lookahead historical slices
// - Avoid repeated Array.filter() calls
// - Maintain per-timeframe cursor positions
// ================================================================

import { Candle } from '../config/types';
import {
    extractRequestedTimeframes,
    normalizeTimeframe,
} from '../pine/interpreter';

export interface PreparedTimeframe {
    timeframe: string;
    candles: Candle[];
    timestamps: number[];
}

export interface DataFeedSnapshot {
    timestamp: number;
    candleMap: Map<string, Candle[]>;
}

export class HistoricalDataFeed {

    private readonly baseTimeframe: string;

    private readonly data:
        Map<string, PreparedTimeframe>;

    /**
     * Current cursor for each timeframe.
     *
     * cursor = index of last candle visible
     * at the current base-bar timestamp.
     */
    private cursors:
        Map<string, number>;

    /**
     * Last snapshot timestamp.
     */
    private currentTimestamp = 0;

    constructor(
        candleMap: Map<string, Candle[]>,
        baseTimeframe = '5m'
    ) {

        this.baseTimeframe =
            normalizeTimeframe(
                baseTimeframe
            );

        this.data =
            new Map();

        this.cursors =
            new Map();

        this.prepareData(
            candleMap
        );
    }

    // ============================================================
    // Prepare data
    // ============================================================

    private prepareData(
        candleMap: Map<string, Candle[]>
    ): void {

        for (
            const [rawTf, rawCandles]
            of candleMap.entries()
        ) {

            const timeframe =
                normalizeTimeframe(
                    rawTf
                );

            if (
                !Array.isArray(rawCandles) ||
                rawCandles.length === 0
            ) {
                continue;
            }

            // ----------------------------------------------------
            // Copy the array so we never mutate caller data.
            // ----------------------------------------------------

            const candles =
                rawCandles
                    .filter(
                        candle =>
                            Number.isFinite(
                                candle.timestamp
                            ) &&
                            Number.isFinite(
                                candle.open
                            ) &&
                            Number.isFinite(
                                candle.high
                            ) &&
                            Number.isFinite(
                                candle.low
                            ) &&
                            Number.isFinite(
                                candle.close
                            )
                    )
                    .slice()
                    .sort(
                        (a, b) =>
                            a.timestamp -
                            b.timestamp
                    );

            if (!candles.length) {
                continue;
            }

            // ----------------------------------------------------
            // Remove duplicate timestamps.
            //
            // Keep the last candle for a timestamp.
            // ----------------------------------------------------

            const deduped: Candle[] = [];

            let lastTimestamp =
                Number.NaN;

            for (const candle of candles) {

                if (
                    candle.timestamp ===
                    lastTimestamp
                ) {

                    deduped[
                        deduped.length - 1
                    ] = candle;

                } else {

                    deduped.push(
                        candle
                    );

                    lastTimestamp =
                        candle.timestamp;
                }
            }

            this.data.set(
                timeframe,
                {
                    timeframe,
                    candles: deduped,
                    timestamps:
                        deduped.map(
                            candle =>
                                candle.timestamp
                        ),
                }
            );

            this.cursors.set(
                timeframe,
                -1
            );
        }
    }

    // ============================================================
    // Get base timeframe
    // ============================================================

    getBaseCandles(): Candle[] {

        return (
            this.data.get(
                this.baseTimeframe
            )?.candles ?? []
        );
    }

    // ============================================================
    // Get timeframe
    // ============================================================

    getCandles(
        timeframe: string
    ): Candle[] {

        return (
            this.data.get(
                normalizeTimeframe(
                    timeframe
                )
            )?.candles ?? []
        );
    }

    // ============================================================
    // Available timeframes
    // ============================================================

    getTimeframes(): string[] {

        return Array.from(
            this.data.keys()
        );
    }

    // ============================================================
    // Has timeframe
    // ============================================================

    hasTimeframe(
        timeframe: string
    ): boolean {

        return this.data.has(
            normalizeTimeframe(
                timeframe
            )
        );
    }

    // ============================================================
    // Candle count
    // ============================================================

    getCandleCount(
        timeframe = this.baseTimeframe
    ): number {

        return (
            this.data.get(
                normalizeTimeframe(
                    timeframe
                )
            )?.candles.length ?? 0
        );
    }

    // ============================================================
    // First timestamp
    // ============================================================

    getFirstTimestamp(
        timeframe = this.baseTimeframe
    ): number | undefined {

        const prepared =
            this.data.get(
                normalizeTimeframe(
                    timeframe
                )
            );

        return prepared
            ?.candles[0]
            ?.timestamp;
    }

    // ============================================================
    // Last timestamp
    // ============================================================

    getLastTimestamp(
        timeframe = this.baseTimeframe
    ): number | undefined {

        const prepared =
            this.data.get(
                normalizeTimeframe(
                    timeframe
                )
            );

        return prepared
            ?.candles[
                prepared.candles.length - 1
            ]
            ?.timestamp;
    }

    // ============================================================
    // Reset cursors
    // ============================================================

    reset(): void {

        for (const timeframe of
            this.data.keys()) {

            this.cursors.set(
                timeframe,
                -1
            );
        }

        this.currentTimestamp = 0;
    }

    // ============================================================
    // Move feed to timestamp
    //
    // Uses binary search.
    //
    // This is the key performance improvement over:
    //
    // candles.filter(c => c.timestamp <= timestamp)
    //
    // ============================================================

    advanceTo(
        timestamp: number
    ): void {

        if (
            !Number.isFinite(timestamp)
        ) {
            return;
        }

        this.currentTimestamp =
            timestamp;

        for (const [
            timeframe,
            prepared
        ] of this.data.entries()) {

            const previousCursor =
                this.cursors.get(
                    timeframe
                ) ?? -1;

            // ----------------------------------------------------
            // Fast path:
            //
            // Historical bars normally move forward.
            // Check whether the next candle is still valid.
            // ----------------------------------------------------

            if (
                previousCursor + 1 <
                prepared.candles.length &&
                prepared.timestamps[
                    previousCursor + 1
                ] <= timestamp
            ) {

                let cursor =
                    previousCursor;

                while (
                    cursor + 1 <
                    prepared.candles.length &&
                    prepared.timestamps[
                        cursor + 1
                    ] <= timestamp
                ) {

                    cursor++;
                }

                this.cursors.set(
                    timeframe,
                    cursor
                );

                continue;
            }

            // ----------------------------------------------------
            // If timestamp moved backwards,
            // use binary search.
            // ----------------------------------------------------

            if (
                previousCursor >= 0 &&
                prepared.timestamps[
                    previousCursor
                ] > timestamp
            ) {

                const cursor =
                    this.findLastIndexAtOrBefore(
                        prepared.timestamps,
                        timestamp
                    );

                this.cursors.set(
                    timeframe,
                    cursor
                );
            }
        }
    }

    // ============================================================
    // Get current visible candles
    //
    // No future candles are returned.
    // ============================================================

    getVisibleCandles(
        timeframe = this.baseTimeframe
    ): Candle[] {

        const norm =
            normalizeTimeframe(
                timeframe
            );

        const prepared =
            this.data.get(norm);

        if (!prepared) {
            return [];
        }

        const cursor =
            this.cursors.get(norm) ?? -1;

        if (cursor < 0) {
            return [];
        }

        return prepared.candles.slice(
            0,
            cursor + 1
        );
    }

    // ============================================================
    // Get visible candle map
    //
    // This is what Backtester will pass to Pine interpreter.
    // ============================================================

    getSnapshot(): Map<string, Candle[]> {

        const snapshot =
            new Map<string, Candle[]>();

        for (const timeframe of
            this.data.keys()) {

            const candles =
                this.getVisibleCandles(
                    timeframe
                );

            if (candles.length > 0) {

                snapshot.set(
                    timeframe,
                    candles
                );
            }
        }

        return snapshot;
    }

    // ============================================================
    // Get snapshot object
    // ============================================================

    getSnapshotObject(): DataFeedSnapshot {

        return {
            timestamp:
                this.currentTimestamp,

            candleMap:
                this.getSnapshot(),
        };
    }

    // ============================================================
    // Get current candle
    // ============================================================

    getCurrentCandle(
        timeframe = this.baseTimeframe
    ): Candle | undefined {

        const norm =
            normalizeTimeframe(
                timeframe
            );

        const prepared =
            this.data.get(norm);

        if (!prepared) {
            return undefined;
        }

        const cursor =
            this.cursors.get(norm) ?? -1;

        if (
            cursor < 0 ||
            cursor >= prepared.candles.length
        ) {
            return undefined;
        }

        return prepared.candles[
            cursor
        ];
    }

    // ============================================================
    // Get candle at cursor
    // ============================================================

    getCurrentIndex(
        timeframe = this.baseTimeframe
    ): number {

        return (
            this.cursors.get(
                normalizeTimeframe(
                    timeframe
                )
            ) ?? -1
        );
    }

    // ============================================================
    // Check MTF alignment
    // ============================================================

    getVisibleTimestamp(
        timeframe: string
    ): number | undefined {

        const candle =
            this.getCurrentCandle(
                timeframe
            );

        return candle?.timestamp;
    }

    // ============================================================
    // Detect requested strategy timeframes
    // ============================================================

    static getRequiredTimeframes(
        script: string,
        baseTimeframe = '5m'
    ): string[] {

        return extractRequestedTimeframes(
            script,
            normalizeTimeframe(
                baseTimeframe
            )
        ).map(
            timeframe =>
                normalizeTimeframe(
                    timeframe
                )
        );
    }

    // ============================================================
    // Validate strategy data requirements
    // ============================================================

    validateRequiredTimeframes(
        script: string
    ): {
        required: string[];
        available: string[];
        missing: string[];
    } {

        const required =
            HistoricalDataFeed
                .getRequiredTimeframes(
                    script,
                    this.baseTimeframe
                );

        const available =
            this.getTimeframes();

        const missing =
            required.filter(
                timeframe =>
                    !this.hasTimeframe(
                        timeframe
                    )
            );

        return {
            required,
            available,
            missing,
        };
    }

    // ============================================================
    // Binary search
    // ============================================================

    private findLastIndexAtOrBefore(
        timestamps: number[],
        target: number
    ): number {

        let left = 0;

        let right =
            timestamps.length - 1;

        let answer = -1;

        while (
            left <= right
        ) {

            const middle =
                Math.floor(
                    (left + right) / 2
                );

            if (
                timestamps[middle] <=
                target
            ) {

                answer =
                    middle;

                left =
                    middle + 1;

            } else {

                right =
                    middle - 1;
            }
        }

        return answer;
    }
}
