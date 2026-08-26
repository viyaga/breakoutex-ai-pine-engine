// ================================================================
// BreakoutEx AI — Zero-Copy Candle Series View
//
// Pine-oriented indexed view over Candle[].
//
// Design goals:
//   - Zero candle-array allocations
//   - O(1) OHLCV access
//   - Safe historical access
//   - Pine-style relative indexing helpers
//   - No mutation of source candles
// ================================================================

import { Candle } from '../config/types';

export class CandleSeriesView {
    private readonly candles: readonly Candle[];

    constructor(candles: Candle[]) {
        this.candles = candles;
    }

    // ============================================================
    // Basic properties
    // ============================================================

    get length(): number {
        return this.candles.length;
    }

    get isEmpty(): boolean {
        return this.candles.length === 0;
    }

    // ============================================================
    // Absolute access
    // ============================================================

    get(index: number): Candle | undefined {
        if (!Number.isInteger(index) || index < 0) {
            return undefined;
        }

        return this.candles[index];
    }

    has(index: number): boolean {
        return (
            Number.isInteger(index) &&
            index >= 0 &&
            index < this.candles.length
        );
    }

    // ============================================================
    // OHLCV
    // ============================================================

    open(index: number): number {
        return this.candles[index]?.open ?? NaN;
    }

    high(index: number): number {
        return this.candles[index]?.high ?? NaN;
    }

    low(index: number): number {
        return this.candles[index]?.low ?? NaN;
    }

    close(index: number): number {
        return this.candles[index]?.close ?? NaN;
    }

    volume(index: number): number {
        return this.candles[index]?.volume ?? NaN;
    }

    timestamp(index: number): number {
        return this.candles[index]?.timestamp ?? NaN;
    }

    // ============================================================
    // Derived price series
    // ============================================================

    hl2(index: number): number {
        const h = this.high(index);
        const l = this.low(index);

        if (Number.isNaN(h) || Number.isNaN(l)) {
            return NaN;
        }

        return (h + l) / 2;
    }

    hlc3(index: number): number {
        const h = this.high(index);
        const l = this.low(index);
        const c = this.close(index);

        if (
            Number.isNaN(h) ||
            Number.isNaN(l) ||
            Number.isNaN(c)
        ) {
            return NaN;
        }

        return (h + l + c) / 3;
    }

    ohlc4(index: number): number {
        const o = this.open(index);
        const h = this.high(index);
        const l = this.low(index);
        const c = this.close(index);

        if (
            Number.isNaN(o) ||
            Number.isNaN(h) ||
            Number.isNaN(l) ||
            Number.isNaN(c)
        ) {
            return NaN;
        }

        return (o + h + l + c) / 4;
    }

    // ============================================================
    // Pine-style historical access
    //
    // currentIndex = current Pine bar
    // offset = 0    => current bar
    // offset = 1    => previous bar
    // offset = 2    => two bars ago
    //
    // Example:
    //
    // view.value('close', currentIndex, 1)
    //
    // represents:
    //
    // close[1]
    // ============================================================

    historicalIndex(
        currentIndex: number,
        offset: number
    ): number {
        if (
            !Number.isInteger(currentIndex) ||
            !Number.isInteger(offset)
        ) {
            return -1;
        }

        const index = currentIndex - offset;

        if (index < 0 || index >= this.candles.length) {
            return -1;
        }

        return index;
    }

    historical(
        currentIndex: number,
        offset: number
    ): Candle | undefined {
        const index = this.historicalIndex(
            currentIndex,
            offset
        );

        return index < 0
            ? undefined
            : this.candles[index];
    }

    historicalOpen(
        currentIndex: number,
        offset = 0
    ): number {
        const index = this.historicalIndex(
            currentIndex,
            offset
        );

        return index < 0
            ? NaN
            : this.open(index);
    }

    historicalHigh(
        currentIndex: number,
        offset = 0
    ): number {
        const index = this.historicalIndex(
            currentIndex,
            offset
        );

        return index < 0
            ? NaN
            : this.high(index);
    }

    historicalLow(
        currentIndex: number,
        offset = 0
    ): number {
        const index = this.historicalIndex(
            currentIndex,
            offset
        );

        return index < 0
            ? NaN
            : this.low(index);
    }

    historicalClose(
        currentIndex: number,
        offset = 0
    ): number {
        const index = this.historicalIndex(
            currentIndex,
            offset
        );

        return index < 0
            ? NaN
            : this.close(index);
    }

    historicalVolume(
        currentIndex: number,
        offset = 0
    ): number {
        const index = this.historicalIndex(
            currentIndex,
            offset
        );

        return index < 0
            ? NaN
            : this.volume(index);
    }

    // ============================================================
    // Generic historical value
    // ============================================================

    value(
        field:
            | 'open'
            | 'high'
            | 'low'
            | 'close'
            | 'volume'
            | 'timestamp'
            | 'hl2'
            | 'hlc3'
            | 'ohlc4',
        currentIndex: number,
        offset = 0
    ): number {
        const index = this.historicalIndex(
            currentIndex,
            offset
        );

        if (index < 0) {
            return NaN;
        }

        switch (field) {
            case 'open':
                return this.open(index);

            case 'high':
                return this.high(index);

            case 'low':
                return this.low(index);

            case 'close':
                return this.close(index);

            case 'volume':
                return this.volume(index);

            case 'timestamp':
                return this.timestamp(index);

            case 'hl2':
                return this.hl2(index);

            case 'hlc3':
                return this.hlc3(index);

            case 'ohlc4':
                return this.ohlc4(index);

            default:
                return NaN;
        }
    }

    // ============================================================
    // Boundary helpers
    // ============================================================

    firstIndex(): number {
        return this.candles.length > 0 ? 0 : -1;
    }

    lastIndex(): number {
        return this.candles.length > 0
            ? this.candles.length - 1
            : -1;
    }

    clampIndex(index: number): number {
        if (this.candles.length === 0) {
            return -1;
        }

        if (index < 0) {
            return 0;
        }

        if (index >= this.candles.length) {
            return this.candles.length - 1;
        }

        return index;
    }
}
