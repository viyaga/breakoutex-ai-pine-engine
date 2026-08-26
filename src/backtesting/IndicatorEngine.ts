// ================================================================
// BreakoutEx AI — Precomputed Indicator Engine
//
// Calculates complete indicator series over a full candle array.
// Results are cached by indicator name and period for O(1) bar lookups.
//
// Math is audited to match `src/pine/indicators.ts` with zero divergence.
// ================================================================

import { Candle } from '../config/types';
import * as Ind from '../pine/indicators';

export class IndicatorEngine {

    private readonly cache =
        new Map<string, number[]>();

    private _close?: number[];
    private _open?: number[];
    private _high?: number[];
    private _low?: number[];
    private _volume?: number[];

    constructor(
        private readonly candles: Candle[]
    ) {}

    ema(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' = 'close'
    ): number[] {

        const src = this.getSourceSeries(source);
        return this.getOrCalculate(
            `ema:${period}:${source}`,
            () => Ind.ema(src, period)
        );
    }

    sma(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' = 'close'
    ): number[] {

        const src = this.getSourceSeries(source);
        return this.getOrCalculate(
            `sma:${period}:${source}`,
            () => Ind.sma(src, period)
        );
    }

    wma(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' = 'close'
    ): number[] {

        const src = this.getSourceSeries(source);
        return this.getOrCalculate(
            `wma:${period}:${source}`,
            () => Ind.wma(src, period)
        );
    }

    hma(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' = 'close'
    ): number[] {

        const src = this.getSourceSeries(source);
        return this.getOrCalculate(
            `hma:${period}:${source}`,
            () => Ind.hma(src, period)
        );
    }

    rma(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' = 'close'
    ): number[] {

        const src = this.getSourceSeries(source);
        return this.getOrCalculate(
            `rma:${period}:${source}`,
            () => Ind.rma(src, period)
        );
    }

    rsi(
        period: number,
        source: 'close' | 'open' | 'high' | 'low' = 'close'
    ): number[] {

        const src = this.getSourceSeries(source);
        return this.getOrCalculate(
            `rsi:${period}:${source}`,
            () => Ind.rsi(src, period)
        );
    }

    atr(
        period: number
    ): number[] {

        return this.getOrCalculate(
            `atr:${period}`,
            () => Ind.atr(this.candles, period)
        );
    }

    bbands(
        period = 20,
        mult = 2,
        source: 'close' | 'open' | 'high' | 'low' = 'close'
    ) {

        const src = this.getSourceSeries(source);
        return Ind.bbands(src, period, mult);
    }

    donchian(
        period = 20
    ) {

        return Ind.donchian(this.candles, period);
    }

    supertrend(
        period = 10,
        factor = 3
    ) {

        return Ind.supertrend(this.candles, period, factor);
    }

    vwap(): number[] {

        return this.getOrCalculate(
            'vwap',
            () => Ind.vwap(this.candles)
        );
    }

    close(): number[] {

        if (!this._close) {
            this._close = this.candles.map(c => c.close);
        }
        return this._close;
    }

    open(): number[] {

        if (!this._open) {
            this._open = this.candles.map(c => c.open);
        }
        return this._open;
    }

    high(): number[] {

        if (!this._high) {
            this._high = this.candles.map(c => c.high);
        }
        return this._high;
    }

    low(): number[] {

        if (!this._low) {
            this._low = this.candles.map(c => c.low);
        }
        return this._low;
    }

    volume(): number[] {

        if (!this._volume) {
            this._volume = this.candles.map(c => c.volume);
        }
        return this._volume;
    }

    private getSourceSeries(source: 'close' | 'open' | 'high' | 'low'): number[] {

        switch (source) {
            case 'open':
                return this.open();
            case 'high':
                return this.high();
            case 'low':
                return this.low();
            case 'close':
            default:
                return this.close();
        }
    }

    private getOrCalculate(
        key: string,
        calculate: () => number[]
    ): number[] {

        const existing =
            this.cache.get(key);

        if (
            existing
        ) {

            return existing;
        }

        const values =
            calculate();

        this.cache.set(
            key,
            values
        );

        return values;
    }
}
