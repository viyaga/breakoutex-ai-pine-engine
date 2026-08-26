// ================================================================
// BreakoutEx AI — Zero-Copy Candle Series View
//
// Provides indexed access without creating:
//   candles.map(...)
//   candles.slice(...)
// ================================================================

import { Candle } from '../config/types';

export class CandleSeriesView {
    constructor(
        private readonly candles: Candle[]
    ) {}

    get length(): number {
        return this.candles.length;
    }

    get(index: number): Candle | undefined {
        return this.candles[index];
    }

    open(index: number): number {
        return this.candles[index].open;
    }

    high(index: number): number {
        return this.candles[index].high;
    }

    low(index: number): number {
        return this.candles[index].low;
    }

    close(index: number): number {
        return this.candles[index].close;
    }

    volume(index: number): number {
        return this.candles[index].volume;
    }

    timestamp(index: number): number {
        return this.candles[index].timestamp;
    }
}
