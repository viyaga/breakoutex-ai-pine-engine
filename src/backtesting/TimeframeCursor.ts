// ================================================================
// BreakoutEx AI — Timeframe Cursor
//
// Tracks the currently visible bar of a higher timeframe while
// iterating through a base timeframe.
//
// Responsibilities:
//   - O(1) forward HTF cursor advancement
//   - Current HTF index
//   - Previous HTF index
//   - HTF confirmation state
//   - Base/HTF index mapping
//
// Does NOT:
//   - aggregate candles
//   - evaluate Pine expressions
//   - calculate indicators
//
// MTFSeriesCache owns market-data construction.
// Pine interpreter owns expression semantics.
// ================================================================

import { Candle } from '../config/types';
import {
    MTFSeriesContext,
} from './MTFSeriesCache';

// ================================================================
// Snapshot
// ================================================================

export interface TimeframeCursorSnapshot {
    readonly baseIndex: number;
    readonly htfIndex: number;

    readonly previousHtfIndex: number;

    readonly confirmed: boolean;

    readonly firstBaseIndex: number;
    readonly lastBaseIndex: number;
}

// ================================================================
// Cursor
// ================================================================

export class TimeframeCursor {

    private baseIndex = -1;

    private htfIndex = -1;

    private previousHtfIndex = -1;

    private confirmed = false;

    private readonly candlesArr: readonly Candle[];
    private readonly mtf?: MTFSeriesContext;

    constructor(
        input: MTFSeriesContext | readonly Candle[] | Candle[]
    ) {
        if (Array.isArray(input)) {
            this.candlesArr = input;
        } else {
            this.mtf = input as MTFSeriesContext;
            this.candlesArr = this.mtf.candles;
        }
    }

    // ============================================================
    // Legacy / direct candle navigation
    // ============================================================

    advanceTo(timestamp: number): number {
        while (
            this.htfIndex + 1 < this.candlesArr.length &&
            this.candlesArr[this.htfIndex + 1].timestamp <= timestamp
        ) {
            this.htfIndex++;
        }
        return this.htfIndex;
    }

    currentIndex(): number {
        return this.htfIndex;
    }

    current(): Candle | undefined {
        if (this.htfIndex < 0 || this.htfIndex >= this.candlesArr.length) {
            return undefined;
        }
        return this.candlesArr[this.htfIndex];
    }

    // ============================================================
    // Position
    // ============================================================

    getBaseIndex(): number {
        return this.baseIndex;
    }

    getHTFIndex(): number {
        return this.htfIndex;
    }

    getPreviousHTFIndex(): number {
        return this.previousHtfIndex;
    }

    // ============================================================
    // Current HTF bar
    // ============================================================

    getCurrentBar() {
        if (!this.mtf) return undefined;
        if (
            this.htfIndex < 0 ||
            this.htfIndex >=
                this.mtf.bars.length
        ) {
            return undefined;
        }

        return this.mtf.bars[
            this.htfIndex
        ];
    }

    getPreviousBar() {
        if (!this.mtf) return undefined;
        if (
            this.previousHtfIndex < 0 ||
            this.previousHtfIndex >=
                this.mtf.bars.length
        ) {
            return undefined;
        }

        return this.mtf.bars[
            this.previousHtfIndex
        ];
    }

    // ============================================================
    // Confirmation
    // ============================================================

    isConfirmed(): boolean {
        return this.confirmed;
    }

    // ============================================================
    // Reset
    // ============================================================

    reset(): void {
        this.baseIndex = -1;
        this.htfIndex = -1;
        this.previousHtfIndex = -1;
        this.confirmed = false;
    }

    // ============================================================
    // Move to an exact base bar
    // ============================================================

    seek(
        baseIndex: number
    ): TimeframeCursorSnapshot {
        if (
            !this.mtf ||
            baseIndex < 0 ||
            baseIndex >=
                this.mtf.baseToHTF.length
        ) {
            this.baseIndex =
                baseIndex;

            this.htfIndex = -1;

            this.previousHtfIndex =
                -1;

            this.confirmed =
                false;

            return this.snapshot();
        }

        const nextHTF =
            this.mtf.baseToHTF[
                baseIndex
            ];

        if (
            nextHTF < 0
        ) {
            this.baseIndex =
                baseIndex;

            this.htfIndex = -1;

            this.previousHtfIndex =
                -1;

            this.confirmed =
                false;

            return this.snapshot();
        }

        this.previousHtfIndex =
            nextHTF > 0
                ? nextHTF - 1
                : -1;

        this.baseIndex =
            baseIndex;

        this.htfIndex =
            nextHTF;

        this.confirmed =
            this.mtf.baseConfirmed[
                baseIndex
            ] ?? false;

        return this.snapshot();
    }

    // ============================================================
    // Forward-only advancement
    // ============================================================

    advance(
        baseIndex: number
    ): TimeframeCursorSnapshot {
        if (
            baseIndex <
            this.baseIndex
        ) {
            return this.seek(
                baseIndex
            );
        }

        if (
            baseIndex ===
            this.baseIndex
        ) {
            return this.snapshot();
        }

        if (
            !this.mtf ||
            baseIndex < 0 ||
            baseIndex >=
                this.mtf.baseToHTF.length
        ) {
            return this.seek(
                baseIndex
            );
        }

        const nextHTF =
            this.mtf.baseToHTF[
                baseIndex
            ];

        if (
            nextHTF < 0
        ) {
            this.baseIndex =
                baseIndex;

            this.htfIndex =
                -1;

            this.previousHtfIndex =
                -1;

            this.confirmed =
                false;

            return this.snapshot();
        }

        if (
            nextHTF !==
            this.htfIndex
        ) {
            this.previousHtfIndex =
                this.htfIndex;

            this.htfIndex =
                nextHTF;
        }

        this.baseIndex =
            baseIndex;

        this.confirmed =
            this.mtf.baseConfirmed[
                baseIndex
            ] ?? false;

        return this.snapshot();
    }

    // ============================================================
    // Relative HTF indexing
    // ============================================================

    getRelativeIndex(
        offset: number
    ): number {
        if (
            this.htfIndex < 0 ||
            !this.mtf
        ) {
            return -1;
        }

        const index =
            this.htfIndex -
            offset;

        if (
            index < 0 ||
            index >=
                this.mtf.bars.length
        ) {
            return -1;
        }

        return index;
    }

    getBarAt(
        offset: number
    ) {
        if (!this.mtf) return undefined;
        const index =
            this.getRelativeIndex(
                offset
            );

        if (
            index < 0
        ) {
            return undefined;
        }

        return this.mtf.bars[
            index
        ];
    }

    // ============================================================
    // Series access
    // ============================================================

    getSeriesValue(
        values: readonly number[],
        offset = 0
    ): number {
        const index =
            this.getRelativeIndex(
                offset
            );

        if (
            index < 0 ||
            index >=
                values.length
        ) {
            return NaN;
        }

        return values[index];
    }

    // ============================================================
    // Current HTF OHLCV
    // ============================================================

    open(): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.open
        );
    }

    high(): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.high
        );
    }

    low(): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.low
        );
    }

    close(): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.close
        );
    }

    volume(): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.volume
        );
    }

    hl2(): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.hl2
        );
    }

    hlc3(): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.hlc3
        );
    }

    ohlc4(): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.ohlc4
        );
    }

    // ============================================================
    // Historical OHLCV
    // ============================================================

    openAt(
        offset: number
    ): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.open,
            offset
        );
    }

    highAt(
        offset: number
    ): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.high,
            offset
        );
    }

    lowAt(
        offset: number
    ): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.low,
            offset
        );
    }

    closeAt(
        offset: number
    ): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.close,
            offset
        );
    }

    volumeAt(
        offset: number
    ): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.volume,
            offset
        );
    }

    hl2At(
        offset: number
    ): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.hl2,
            offset
        );
    }

    hlc3At(
        offset: number
    ): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.hlc3,
            offset
        );
    }

    ohlc4At(
        offset: number
    ): number {
        if (!this.mtf) return NaN;
        return this.getSeriesValue(
            this.mtf.series.ohlc4,
            offset
        );
    }

    // ============================================================
    // Range information
    // ============================================================

    getFirstBaseIndex(): number {
        if (
            this.htfIndex < 0 ||
            !this.mtf
        ) {
            return -1;
        }

        return (
            this.mtf.htfFirstBaseIndex[
                this.htfIndex
            ] ?? -1
        );
    }

    getLastBaseIndex(): number {
        if (
            this.htfIndex < 0 ||
            !this.mtf
        ) {
            return -1;
        }

        return (
            this.mtf.htfLastBaseIndex[
                this.htfIndex
            ] ?? -1
        );
    }

    isFirstBaseBarOfHTF(): boolean {
        return (
            this.baseIndex >= 0 &&
            this.baseIndex ===
                this.getFirstBaseIndex()
        );
    }

    isLastBaseBarOfHTF(): boolean {
        return (
            this.baseIndex >= 0 &&
            this.baseIndex ===
                this.getLastBaseIndex()
        );
    }

    // ============================================================
    // Snapshot
    // ============================================================

    snapshot(): TimeframeCursorSnapshot {
        return {
            baseIndex:
                this.baseIndex,

            htfIndex:
                this.htfIndex,

            previousHtfIndex:
                this.previousHtfIndex,

            confirmed:
                this.confirmed,

            firstBaseIndex:
                this.getFirstBaseIndex(),

            lastBaseIndex:
                this.getLastBaseIndex(),
        };
    }
}
