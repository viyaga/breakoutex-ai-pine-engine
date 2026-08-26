// ================================================================
// BreakoutEx AI — Multi-Timeframe Cursor
//
// Fast amortized O(1) cursor for tracking the latest closed candle
// at or before a target timestamp in forward-moving historical simulations.
// ================================================================

import { Candle } from '../config/types';

export class TimeframeCursor {
    private index = -1;

    constructor(
        private readonly candles: Candle[]
    ) {}

    advanceTo(timestamp: number): number {
        while (
            this.index + 1 < this.candles.length &&
            this.candles[this.index + 1].timestamp <= timestamp
        ) {
            this.index++;
        }
        return this.index;
    }

    currentIndex(): number {
        return this.index;
    }

    current(): Candle | undefined {
        if (this.index < 0) {
            return undefined;
        }
        return this.candles[this.index];
    }

    reset(): void {
        this.index = -1;
    }
}
