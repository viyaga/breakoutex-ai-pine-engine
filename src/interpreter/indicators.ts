// ================================================================
// BreakoutEx AI — Pine Indicator Runtime
//
// Canonical indicator implementation used by:
//
//   Pine interpreter
//   IndicatorEngine
//   MTF indicator engines
//
// Design goals:
//   - Pine-compatible warmup / NaN behavior
//   - No slice()/reduce()/spread in rolling hot paths
//   - O(n) rolling calculations where practical
//   - Stable array lengths
//   - Deterministic results
//   - Preserve existing public API
// ================================================================

import { Candle } from '../config/types';

// ================================================================
// Validation helpers
// ================================================================

function validPeriod(period: number): boolean {
    return (
        Number.isFinite(period) &&
        Number.isInteger(period) &&
        period > 0
    );
}

function invalidPeriodResult(
    length: number
): number[] {
    return new Array<number>(length).fill(NaN);
}

// ================================================================
// EMA
// ================================================================
//
// Pine-style EMA seed:
//
// First valid source value is used as the initial EMA.
// Subsequent values use:
//   EMA = src * k + previousEMA * (1-k)
//
// ================================================================

export function ema(
    src: readonly number[],
    period: number
): number[] {
    const n = src.length;

    if (
        n === 0 ||
        !validPeriod(period)
    ) {
        return invalidPeriodResult(n);
    }

    const result = new Array<number>(n).fill(NaN);

    const k = 2 / (period + 1);

    let first = -1;

    for (let i = 0; i < n; i++) {
        if (!Number.isNaN(src[i])) {
            first = i;
            break;
        }
    }

    if (first < 0) {
        return result;
    }

    result[first] = src[first];

    for (let i = first + 1; i < n; i++) {
        const value = src[i];

        if (Number.isNaN(value)) {
            result[i] = result[i - 1];
            continue;
        }

        result[i] =
            value * k +
            result[i - 1] * (1 - k);
    }

    return result;
}

// ================================================================
// SMA
// ================================================================

export function sma(
    src: readonly number[],
    period: number
): number[] {
    const n = src.length;

    if (
        n === 0 ||
        !validPeriod(period)
    ) {
        return invalidPeriodResult(n);
    }

    const result = new Array<number>(n).fill(NaN);

    let sum = 0;
    let validCount = 0;

    for (let i = 0; i < n; i++) {
        const value = src[i];

        if (!Number.isNaN(value)) {
            sum += value;
            validCount++;
        }

        const removeIndex =
            i - period;

        if (removeIndex >= 0) {
            const old = src[removeIndex];

            if (!Number.isNaN(old)) {
                sum -= old;
                validCount--;
            }
        }

        if (
            i >= period - 1 &&
            validCount === period
        ) {
            result[i] =
                sum / period;
        }
    }

    return result;
}

// ================================================================
// WMA
// ================================================================

export function wma(
    src: readonly number[],
    period: number
): number[] {
    const n = src.length;

    if (
        n === 0 ||
        !validPeriod(period)
    ) {
        return invalidPeriodResult(n);
    }

    const result = new Array<number>(n).fill(NaN);

    const weight =
        (period * (period + 1)) / 2;

    let valid = 0;

    for (let i = 0; i < n; i++) {
        const value = src[i];

        if (!Number.isNaN(value)) {
            valid++;
        }

        const removeIndex =
            i - period;

        if (removeIndex >= 0) {
            const old = src[removeIndex];

            if (!Number.isNaN(old)) {
                valid--;
            }
        }

        if (
            i >= period - 1 &&
            valid === period
        ) {
            let weightedExact = 0;

            for (
                let j = 0;
                j < period;
                j++
            ) {
                const v =
                    src[i - j];

                if (Number.isNaN(v)) {
                    weightedExact = NaN;
                    break;
                }

                weightedExact +=
                    v * (period - j);
            }

            if (!Number.isNaN(weightedExact)) {
                result[i] =
                    weightedExact / weight;
            }
        }
    }

    return result;
}

// ================================================================
// HMA
// ================================================================

export function hma(
    src: readonly number[],
    period: number
): number[] {
    const n = src.length;

    if (
        n === 0 ||
        !validPeriod(period)
    ) {
        return invalidPeriodResult(n);
    }

    const half =
        Math.max(1, Math.floor(period / 2));

    const sqrtPeriod =
        Math.max(
            1,
            Math.round(Math.sqrt(period))
        );

    const wmaHalf =
        wma(src, half);

    const wmaFull =
        wma(src, period);

    const diff =
        new Array<number>(n).fill(NaN);

    for (let i = 0; i < n; i++) {
        if (
            Number.isNaN(wmaHalf[i]) ||
            Number.isNaN(wmaFull[i])
        ) {
            continue;
        }

        diff[i] =
            2 * wmaHalf[i] -
            wmaFull[i];
    }

    return wma(
        diff,
        sqrtPeriod
    );
}

// ================================================================
// DEMA
// ================================================================

export function dema(
    src: readonly number[],
    period: number
): number[] {
    const e1 = ema(src, period);
    const e2 = ema(e1, period);

    const result =
        new Array<number>(src.length).fill(NaN);

    for (let i = 0; i < src.length; i++) {
        if (
            Number.isNaN(e1[i]) ||
            Number.isNaN(e2[i])
        ) {
            continue;
        }

        result[i] =
            2 * e1[i] -
            e2[i];
    }

    return result;
}

// ================================================================
// TEMA
// ================================================================

export function tema(
    src: readonly number[],
    period: number
): number[] {
    const e1 = ema(src, period);
    const e2 = ema(e1, period);
    const e3 = ema(e2, period);

    const result =
        new Array<number>(src.length).fill(NaN);

    for (let i = 0; i < src.length; i++) {
        if (
            Number.isNaN(e1[i]) ||
            Number.isNaN(e2[i]) ||
            Number.isNaN(e3[i])
        ) {
            continue;
        }

        result[i] =
            3 * e1[i] -
            3 * e2[i] +
            e3[i];
    }

    return result;
}

// ================================================================
// RMA / Wilder Moving Average
// ================================================================

export function rma(
    src: readonly number[],
    period: number
): number[] {
    const n = src.length;

    if (
        n === 0 ||
        !validPeriod(period)
    ) {
        return invalidPeriodResult(n);
    }

    const result =
        new Array<number>(n).fill(NaN);

    let sum = 0;
    let count = 0;
    let seedIndex = -1;

    for (let i = 0; i < n; i++) {
        const value = src[i];

        if (Number.isNaN(value)) {
            continue;
        }

        sum += value;
        count++;

        if (count === period) {
            seedIndex = i;
            break;
        }
    }

    if (seedIndex < 0) {
        return result;
    }

    result[seedIndex] =
        sum / period;

    for (
        let i = seedIndex + 1;
        i < n;
        i++
    ) {
        const value = src[i];

        if (Number.isNaN(value)) {
            result[i] =
                result[i - 1];

            continue;
        }

        result[i] =
            (
                result[i - 1] *
                    (period - 1) +
                value
            ) / period;
    }

    return result;
}

// ================================================================
// True Range
// ================================================================

function trueRange(
    candles: readonly Candle[] | Candle[]
): number[] {
    const n = candles.length;

    const result =
        new Array<number>(n).fill(NaN);

    if (n === 0) {
        return result;
    }

    result[0] =
        candles[0].high -
        candles[0].low;

    for (let i = 1; i < n; i++) {
        const current =
            candles[i];

        const previousClose =
            candles[i - 1].close;

        result[i] =
            Math.max(
                current.high -
                    current.low,

                Math.abs(
                    current.high -
                    previousClose
                ),

                Math.abs(
                    current.low -
                    previousClose
                )
            );
    }

    return result;
}

// ================================================================
// ATR
// ================================================================

export function atr(
    candles: readonly Candle[] | Candle[],
    period: number
): number[] {
    if (
        !validPeriod(period)
    ) {
        return invalidPeriodResult(
            candles.length
        );
    }

    return rma(
        trueRange(candles),
        period
    );
}

// ================================================================
// RSI
// ================================================================

export function rsi(
    src: readonly number[],
    period: number
): number[] {
    const n = src.length;

    if (
        n === 0 ||
        !validPeriod(period)
    ) {
        return invalidPeriodResult(n);
    }

    const gains =
        new Array<number>(n).fill(NaN);

    const losses =
        new Array<number>(n).fill(NaN);

    gains[0] = 0;
    losses[0] = 0;

    for (let i = 1; i < n; i++) {
        const current =
            src[i];

        const previous =
            src[i - 1];

        if (
            Number.isNaN(current) ||
            Number.isNaN(previous)
        ) {
            continue;
        }

        const difference =
            current - previous;

        gains[i] =
            difference > 0
                ? difference
                : 0;

        losses[i] =
            difference < 0
                ? -difference
                : 0;
    }

    const avgGain =
        rma(gains, period);

    const avgLoss =
        rma(losses, period);

    const result =
        new Array<number>(n).fill(NaN);

    for (let i = 0; i < n; i++) {
        const gain =
            avgGain[i];

        const loss =
            avgLoss[i];

        if (
            Number.isNaN(gain) ||
            Number.isNaN(loss)
        ) {
            continue;
        }

        if (loss === 0) {
            result[i] =
                gain === 0
                    ? 50
                    : 100;

            continue;
        }

        const rs =
            gain / loss;

        result[i] =
            100 -
            100 / (1 + rs);
    }

    return result;
}

// ================================================================
// MACD
// ================================================================

export function macd(
    src: readonly number[],
    fast = 12,
    slow = 26,
    signal = 9
): {
    macdLine: number[];
    signalLine: number[];
    histogram: number[];
} {
    const fastEma =
        ema(src, fast);

    const slowEma =
        ema(src, slow);

    const n = src.length;

    const macdLine =
        new Array<number>(n).fill(NaN);

    for (let i = 0; i < n; i++) {
        if (
            Number.isNaN(
                fastEma[i]
            ) ||
            Number.isNaN(
                slowEma[i]
            )
        ) {
            continue;
        }

        macdLine[i] =
            fastEma[i] -
            slowEma[i];
    }

    const signalLine =
        ema(
            macdLine,
            signal
        );

    const histogram =
        new Array<number>(n).fill(NaN);

    for (let i = 0; i < n; i++) {
        if (
            Number.isNaN(
                macdLine[i]
            ) ||
            Number.isNaN(
                signalLine[i]
            )
        ) {
            continue;
        }

        histogram[i] =
            macdLine[i] -
            signalLine[i];
    }

    return {
        macdLine,
        signalLine,
        histogram,
    };
}

// ================================================================
// Rolling standard deviation
// ================================================================

export function stdev(
    src: readonly number[],
    period: number
): number[] {
    const n = src.length;

    if (
        n === 0 ||
        !validPeriod(period)
    ) {
        return invalidPeriodResult(n);
    }

    const result =
        new Array<number>(n).fill(NaN);

    let sum = 0;
    let sumSquares = 0;
    let valid = 0;

    for (let i = 0; i < n; i++) {
        const value =
            src[i];

        if (!Number.isNaN(value)) {
            sum += value;
            sumSquares +=
                value * value;
            valid++;
        }

        const remove =
            i - period;

        if (remove >= 0) {
            const old =
                src[remove];

            if (!Number.isNaN(old)) {
                sum -= old;
                sumSquares -=
                    old * old;
                valid--;
            }
        }

        if (
            i >= period - 1 &&
            valid === period
        ) {
            const mean =
                sum / period;

            const varianceValue =
                (
                    sumSquares -
                    period *
                        mean *
                        mean
                ) / period;

            result[i] =
                Math.sqrt(
                    Math.max(
                        0,
                        varianceValue
                    )
                );
        }
    }

    return result;
}

// ================================================================
// Bollinger Bands
// ================================================================

export function bbands(
    src: readonly number[],
    period = 20,
    mult = 2
): {
    upper: number[];
    middle: number[];
    lower: number[];
    width: number[];
    percentB: number[];
} {
    const n = src.length;

    const middle =
        sma(src, period);

    const deviation =
        stdev(src, period);

    const upper =
        new Array<number>(n).fill(NaN);

    const lower =
        new Array<number>(n).fill(NaN);

    const width =
        new Array<number>(n).fill(NaN);

    const percentB =
        new Array<number>(n).fill(NaN);

    for (let i = 0; i < n; i++) {
        const m =
            middle[i];

        const sd =
            deviation[i];

        if (
            Number.isNaN(m) ||
            Number.isNaN(sd)
        ) {
            continue;
        }

        const u =
            m + mult * sd;

        const l =
            m - mult * sd;

        upper[i] = u;
        lower[i] = l;

        if (m !== 0) {
            width[i] =
                (u - l) / m;
        }

        const range =
            u - l;

        if (range !== 0) {
            percentB[i] =
                (src[i] - l) /
                range;
        }
    }

    return {
        upper,
        middle,
        lower,
        width,
        percentB,
    };
}

export const bollinger =
    bbands;

// ================================================================
// Highest
// ================================================================

export function highest(
    src: readonly number[],
    period: number
): number[] {
    const n = src.length;

    if (
        n === 0 ||
        !validPeriod(period)
    ) {
        return invalidPeriodResult(n);
    }

    const result =
        new Array<number>(n).fill(NaN);

    const deque =
        new Array<number>(n);

    let head = 0;
    let tail = 0;

    for (let i = 0; i < n; i++) {
        const value =
            src[i];

        while (
            head < tail &&
            deque[head] <=
                i - period
        ) {
            head++;
        }

        if (!Number.isNaN(value)) {
            while (
                head < tail &&
                !Number.isNaN(
                    src[deque[tail - 1]]
                ) &&
                src[deque[tail - 1]] <=
                    value
            ) {
                tail--;
            }

            deque[tail++] = i;
        }

        if (i >= period - 1) {
            if (head < tail) {
                result[i] =
                    src[deque[head]];
            }
        }
    }

    return result;
}

// ================================================================
// Lowest
// ================================================================

export function lowest(
    src: readonly number[],
    period: number
): number[] {
    const n = src.length;

    if (
        n === 0 ||
        !validPeriod(period)
    ) {
        return invalidPeriodResult(n);
    }

    const result =
        new Array<number>(n).fill(NaN);

    const deque =
        new Array<number>(n);

    let head = 0;
    let tail = 0;

    for (let i = 0; i < n; i++) {
        const value =
            src[i];

        while (
            head < tail &&
            deque[head] <=
                i - period
        ) {
            head++;
        }

        if (!Number.isNaN(value)) {
            while (
                head < tail &&
                !Number.isNaN(
                    src[deque[tail - 1]]
                ) &&
                src[deque[tail - 1]] >=
                    value
            ) {
                tail--;
            }

            deque[tail++] = i;
        }

        if (i >= period - 1) {
            if (head < tail) {
                result[i] =
                    src[deque[head]];
            }
        }
    }

    return result;
}

// ================================================================
// Sum
// ================================================================

export function sum(
    src: readonly number[],
    period: number
): number[] {
    const n = src.length;

    if (
        n === 0 ||
        !validPeriod(period)
    ) {
        return invalidPeriodResult(n);
    }

    const result =
        new Array<number>(n).fill(NaN);

    let rolling = 0;
    let valid = 0;

    for (let i = 0; i < n; i++) {
        const value =
            src[i];

        if (!Number.isNaN(value)) {
            rolling += value;
            valid++;
        }

        const remove =
            i - period;

        if (remove >= 0) {
            const old =
                src[remove];

            if (!Number.isNaN(old)) {
                rolling -= old;
                valid--;
            }
        }

        if (
            i >= period - 1 &&
            valid === period
        ) {
            result[i] =
                rolling;
        }
    }

    return result;
}

// ================================================================
// Variance
// ================================================================

export function variance(
    src: readonly number[],
    period: number
): number[] {
    const sd =
        stdev(src, period);

    for (let i = 0; i < sd.length; i++) {
        if (!Number.isNaN(sd[i])) {
            sd[i] =
                sd[i] * sd[i];
        }
    }

    return sd;
}

// ================================================================
// Change
// ================================================================

export function change(
    src: readonly number[],
    length = 1
): number[] {
    const n = src.length;

    const result =
        new Array<number>(n).fill(NaN);

    if (
        !validPeriod(length)
    ) {
        return result;
    }

    for (
        let i = length;
        i < n;
        i++
    ) {
        const current =
            src[i];

        const previous =
            src[i - length];

        if (
            Number.isNaN(current) ||
            Number.isNaN(previous)
        ) {
            continue;
        }

        result[i] =
            current - previous;
    }

    return result;
}

export function mom(
    src: readonly number[],
    length: number
): number[] {
    return change(
        src,
        length
    );
}

// ================================================================
// Crossover
// ================================================================

export function crossover(
    a: readonly number[],
    b: readonly number[] | number,
    i: number
): boolean {
    if (
        i <= 0 ||
        i >= a.length
    ) {
        return false;
    }

    const currentA =
        a[i];

    const previousA =
        a[i - 1];

    const currentB =
        typeof b === 'number'
            ? b
            : b[i];

    const previousB =
        typeof b === 'number'
            ? b
            : b[i - 1];

    if (
        Number.isNaN(currentA) ||
        Number.isNaN(previousA) ||
        Number.isNaN(currentB) ||
        Number.isNaN(previousB)
    ) {
        return false;
    }

    return (
        previousA <= previousB &&
        currentA > currentB
    );
}

// ================================================================
// Crossunder
// ================================================================

export function crossunder(
    a: readonly number[],
    b: readonly number[] | number,
    i: number
): boolean {
    if (
        i <= 0 ||
        i >= a.length
    ) {
        return false;
    }

    const currentA =
        a[i];

    const previousA =
        a[i - 1];

    const currentB =
        typeof b === 'number'
            ? b
            : b[i];

    const previousB =
        typeof b === 'number'
            ? b
            : b[i - 1];

    if (
        Number.isNaN(currentA) ||
        Number.isNaN(previousA) ||
        Number.isNaN(currentB) ||
        Number.isNaN(previousB)
    ) {
        return false;
    }

    return (
        previousA >= previousB &&
        currentA < currentB
    );
}

// ================================================================
// Rising
// ================================================================

export function rising(
    src: readonly number[],
    period: number
): boolean[] {
    const n = src.length;

    const result =
        new Array<boolean>(n).fill(false);

    if (
        !validPeriod(period)
    ) {
        return result;
    }

    for (let i = period; i < n; i++) {
        const current =
            src[i];

        let valid = true;

        for (
            let j = 0;
            j < period;
            j++
        ) {
            const previous =
                src[i - j - 1];

            if (
                Number.isNaN(current) ||
                Number.isNaN(previous) ||
                current <= previous
            ) {
                valid = false;
                break;
            }
        }

        result[i] =
            valid;
    }

    return result;
}

// ================================================================
// Falling
// ================================================================

export function falling(
    src: readonly number[],
    period: number
): boolean[] {
    const n = src.length;

    const result =
        new Array<boolean>(n).fill(false);

    if (
        !validPeriod(period)
    ) {
        return result;
    }

    for (let i = period; i < n; i++) {
        const current =
            src[i];

        let valid = true;

        for (
            let j = 0;
            j < period;
            j++
        ) {
            const previous =
                src[i - j - 1];

            if (
                Number.isNaN(current) ||
                Number.isNaN(previous) ||
                current >= previous
            ) {
                valid = false;
                break;
            }
        }

        result[i] =
            valid;
    }

    return result;
}

// ================================================================
// Donchian Channels
// ================================================================

export function donchian(
    candles: readonly Candle[] | Candle[],
    period = 20
): {
    upper: number[];
    lower: number[];
    middle: number[];
} {
    const highs =
        new Array<number>(
            candles.length
        );

    const lows =
        new Array<number>(
            candles.length
        );

    for (
        let i = 0;
        i < candles.length;
        i++
    ) {
        highs[i] =
            candles[i].high;

        lows[i] =
            candles[i].low;
    }

    const upper =
        highest(
            highs,
            period
        );

    const lower =
        lowest(
            lows,
            period
        );

    const middle =
        new Array<number>(
            candles.length
        ).fill(NaN);

    for (
        let i = 0;
        i < candles.length;
        i++
    ) {
        if (
            Number.isNaN(upper[i]) ||
            Number.isNaN(lower[i])
        ) {
            continue;
        }

        middle[i] =
            (upper[i] +
                lower[i]) / 2;
    }

    return {
        upper,
        lower,
        middle,
    };
}

// ================================================================
// Keltner Channels
// ================================================================

export function keltner(
    candles: readonly Candle[] | Candle[],
    period = 20,
    mult = 1.5,
    atrPeriod = 10
): {
    upper: number[];
    lower: number[];
    middle: number[];
} {
    const closes =
        new Array<number>(
            candles.length
        );

    for (
        let i = 0;
        i < candles.length;
        i++
    ) {
        closes[i] =
            candles[i].close;
    }

    const middle =
        ema(
            closes,
            period
        );

    const atrValues =
        atr(
            candles,
            atrPeriod
        );

    const upper =
        new Array<number>(
            candles.length
        ).fill(NaN);

    const lower =
        new Array<number>(
            candles.length
        ).fill(NaN);

    for (
        let i = 0;
        i < candles.length;
        i++
    ) {
        if (
            Number.isNaN(
                middle[i]
            ) ||
            Number.isNaN(
                atrValues[i]
            )
        ) {
            continue;
        }

        upper[i] =
            middle[i] +
            mult * atrValues[i];

        lower[i] =
            middle[i] -
            mult * atrValues[i];
    }

    return {
        upper,
        lower,
        middle,
    };
}

// ================================================================
// MFI
// ================================================================

export function mfi(
    candles: readonly Candle[] | Candle[],
    period = 14
): number[] {
    const n =
        candles.length;

    const result =
        new Array<number>(n).fill(NaN);

    if (
        !validPeriod(period)
    ) {
        return result;
    }

    const positive =
        new Array<number>(n).fill(0);

    const negative =
        new Array<number>(n).fill(0);

    const typical =
        new Array<number>(n).fill(NaN);

    for (let i = 0; i < n; i++) {
        const c =
            candles[i];

        typical[i] =
            (
                c.high +
                c.low +
                c.close
            ) / 3;

        if (i === 0) {
            continue;
        }

        const flow =
            typical[i] *
            c.volume;

        if (
            typical[i] >
            typical[i - 1]
        ) {
            positive[i] =
                flow;
        } else if (
            typical[i] <
            typical[i - 1]
        ) {
            negative[i] =
                flow;
        }
    }

    const positiveSum =
        sum(
            positive,
            period
        );

    const negativeSum =
        sum(
            negative,
            period
        );

    for (let i = 0; i < n; i++) {
        const pos =
            positiveSum[i];

        const neg =
            negativeSum[i];

        if (
            Number.isNaN(pos) ||
            Number.isNaN(neg)
        ) {
            continue;
        }

        if (neg === 0) {
            result[i] =
                pos === 0
                    ? 50
                    : 100;

            continue;
        }

        const ratio =
            pos / neg;

        result[i] =
            100 -
            100 / (1 + ratio);
    }

    return result;
}

// ================================================================
// VWAP
// ================================================================

export function vwap(
    candles: readonly Candle[] | Candle[]
): number[] {
    const n =
        candles.length;

    const result =
        new Array<number>(n).fill(NaN);

    let cumulativeVolume = 0;
    let cumulativeTPV = 0;
    let currentDay = -1;

    for (let i = 0; i < n; i++) {
        const candle =
            candles[i];

        const day =
            Math.floor(
                candle.timestamp /
                    86_400_000
            );

        if (day !== currentDay) {
            currentDay =
                day;

            cumulativeVolume =
                0;

            cumulativeTPV =
                0;
        }

        const typical =
            (
                candle.high +
                candle.low +
                candle.close
            ) / 3;

        cumulativeTPV +=
            typical *
            candle.volume;

        cumulativeVolume +=
            candle.volume;

        if (
            cumulativeVolume !== 0
        ) {
            result[i] =
                cumulativeTPV /
                cumulativeVolume;
        }
    }

    return result;
}

// ================================================================
// CCI
// ================================================================

export function cci(
    candles: readonly Candle[] | Candle[],
    period = 20
): number[] {
    const n =
        candles.length;

    const typical =
        new Array<number>(n);

    for (let i = 0; i < n; i++) {
        typical[i] =
            (
                candles[i].high +
                candles[i].low +
                candles[i].close
            ) / 3;
    }

    const mean =
        sma(
            typical,
            period
        );

    const result =
        new Array<number>(n).fill(NaN);

    for (let i = period - 1; i < n; i++) {
        if (
            Number.isNaN(
                mean[i]
            )
        ) {
            continue;
        }

        let deviation = 0;

        for (
            let j = i - period + 1;
            j <= i;
            j++
        ) {
            deviation +=
                Math.abs(
                    typical[j] -
                    mean[i]
                );
        }

        const mad =
            deviation / period;

        result[i] =
            mad === 0
                ? 0
                : (
                    typical[i] -
                    mean[i]
                ) /
                (0.015 * mad);
    }

    return result;
}

// ================================================================
// Stochastic
// ================================================================

export function stoch(
    src: readonly number[],
    hi: readonly number[],
    lo: readonly number[],
    period: number
): number[] {
    const n =
        src.length;

    const result =
        new Array<number>(n).fill(NaN);

    if (
        !validPeriod(period)
    ) {
        return result;
    }

    for (
        let i = period - 1;
        i < n;
        i++
    ) {
        let highestValue =
            -Infinity;

        let lowestValue =
            Infinity;

        let valid = true;

        for (
            let j = i - period + 1;
            j <= i;
            j++
        ) {
            if (
                Number.isNaN(hi[j]) ||
                Number.isNaN(lo[j])
            ) {
                valid = false;
                break;
            }

            if (
                hi[j] >
                highestValue
            ) {
                highestValue =
                    hi[j];
            }

            if (
                lo[j] <
                lowestValue
            ) {
                lowestValue =
                    lo[j];
            }
        }

        if (!valid) {
            continue;
        }

        const range =
            highestValue -
            lowestValue;

        result[i] =
            range === 0
                ? 0
                : (
                    (
                        src[i] -
                        lowestValue
                    ) /
                    range
                ) * 100;
    }

    return result;
}

// ================================================================
// Stochastic RSI
// ================================================================

export function stochRsi(
    src: readonly number[],
    rsiPeriod = 14,
    stochPeriod = 14,
    smoothK = 3,
    smoothD = 3
): {
    k: number[];
    d: number[];
} {
    const rsiValues =
        rsi(
            src,
            rsiPeriod
        );

    const stochastic =
        new Array<number>(
            src.length
        ).fill(NaN);

    for (
        let i = stochPeriod - 1;
        i < src.length;
        i++
    ) {
        let lowestValue =
            Infinity;

        let highestValue =
            -Infinity;

        let valid = true;

        for (
            let j =
                i - stochPeriod + 1;
            j <= i;
            j++
        ) {
            const value =
                rsiValues[j];

            if (
                Number.isNaN(value)
            ) {
                valid = false;
                break;
            }

            if (
                value <
                lowestValue
            ) {
                lowestValue =
                    value;
            }

            if (
                value >
                highestValue
            ) {
                highestValue =
                    value;
            }
        }

        if (!valid) {
            continue;
        }

        const range =
            highestValue -
            lowestValue;

        stochastic[i] =
            range === 0
                ? 0
                : (
                    (
                        rsiValues[i] -
                        lowestValue
                    ) /
                    range
                ) * 100;
    }

    const k =
        sma(
            stochastic,
            smoothK
        );

    const d =
        sma(
            k,
            smoothD
        );

    return {
        k,
        d,
    };
}

// ================================================================
// ADX / DMI
// ================================================================

export function adx(
    candles: readonly Candle[] | Candle[],
    period = 14
): {
    adx: number[];
    diPlus: number[];
    diMinus: number[];
} {
    const n =
        candles.length;

    const tr =
        new Array<number>(n).fill(NaN);

    const plusDM =
        new Array<number>(n).fill(0);

    const minusDM =
        new Array<number>(n).fill(0);

    for (
        let i = 1;
        i < n;
        i++
    ) {
        const current =
            candles[i];

        const previous =
            candles[i - 1];

        tr[i] =
            Math.max(
                current.high -
                    current.low,

                Math.abs(
                    current.high -
                    previous.close
                ),

                Math.abs(
                    current.low -
                    previous.close
                )
            );

        const upMove =
            current.high -
            previous.high;

        const downMove =
            previous.low -
            current.low;

        if (
            upMove >
                downMove &&
            upMove > 0
        ) {
            plusDM[i] =
                upMove;
        }

        if (
            downMove >
                upMove &&
            downMove > 0
        ) {
            minusDM[i] =
                downMove;
        }
    }

    const smoothTR =
        rma(
            tr,
            period
        );

    const smoothPlus =
        rma(
            plusDM,
            period
        );

    const smoothMinus =
        rma(
            minusDM,
            period
        );

    const diPlus =
        new Array<number>(n).fill(NaN);

    const diMinus =
        new Array<number>(n).fill(NaN);

    const dx =
        new Array<number>(n).fill(NaN);

    for (let i = 0; i < n; i++) {
        if (
            Number.isNaN(
                smoothTR[i]
            ) ||
            smoothTR[i] === 0
        ) {
            continue;
        }

        diPlus[i] =
            (
                smoothPlus[i] /
                smoothTR[i]
            ) * 100;

        diMinus[i] =
            (
                smoothMinus[i] /
                smoothTR[i]
            ) * 100;

        const denominator =
            diPlus[i] +
            diMinus[i];

        if (
            denominator === 0
        ) {
            dx[i] = 0;
        } else {
            dx[i] =
                (
                    Math.abs(
                        diPlus[i] -
                        diMinus[i]
                    ) /
                    denominator
                ) * 100;
        }
    }

    const adxValues =
        rma(
            dx,
            period
        );

    return {
        adx: adxValues,
        diPlus,
        diMinus,
    };
}

// ================================================================
// Supertrend
// ================================================================

export function supertrend(
    candles: readonly Candle[] | Candle[],
    atrPeriod = 10,
    multiplier = 3
): {
    supertrend: number[];
    direction: number[];
} {
    const n =
        candles.length;

    const result =
        new Array<number>(n).fill(NaN);

    const direction =
        new Array<number>(n).fill(1);

    const atrValues =
        atr(
            candles,
            atrPeriod
        );

    const upper =
        new Array<number>(n).fill(NaN);

    const lower =
        new Array<number>(n).fill(NaN);

    for (
        let i = 0;
        i < n;
        i++
    ) {
        if (
            Number.isNaN(
                atrValues[i]
            )
        ) {
            continue;
        }

        const midpoint =
            (
                candles[i].high +
                candles[i].low
            ) / 2;

        const basicUpper =
            midpoint +
            multiplier *
                atrValues[i];

        const basicLower =
            midpoint -
            multiplier *
                atrValues[i];

        if (i === 0) {
            upper[i] =
                basicUpper;

            lower[i] =
                basicLower;

            continue;
        }

        upper[i] =
            (
                basicUpper <
                    upper[i - 1] ||
                candles[i - 1].close >
                    upper[i - 1]
            )
                ? basicUpper
                : upper[i - 1];

        lower[i] =
            (
                basicLower >
                    lower[i - 1] ||
                candles[i - 1].close <
                    lower[i - 1]
            )
                ? basicLower
                : lower[i - 1];

        if (
            direction[i - 1] === -1 &&
            candles[i].close >
                upper[i]
        ) {
            direction[i] = 1;
        } else if (
            direction[i - 1] === 1 &&
            candles[i].close <
                lower[i]
        ) {
            direction[i] = -1;
        } else {
            direction[i] =
                direction[i - 1];
        }

        result[i] =
            direction[i] === 1
                ? lower[i]
                : upper[i];
    }

    return {
        supertrend: result,
        direction,
    };
}

// ================================================================
// Pivot High
// ================================================================
//
// The returned value is placed on the pivot bar.
// A consumer must respect rightBars confirmation delay.
// ================================================================

export function pivothigh(
    src: readonly number[],
    leftBars: number,
    rightBars: number
): number[] {
    const n =
        src.length;

    const result =
        new Array<number>(n).fill(NaN);

    if (
        leftBars < 0 ||
        rightBars < 0
    ) {
        return result;
    }

    for (
        let center = leftBars;
        center <
            n - rightBars;
        center++
    ) {
        const value =
            src[center];

        if (Number.isNaN(value)) {
            continue;
        }

        let pivot = true;

        for (
            let j =
                center - leftBars;
            j <=
                center + rightBars;
            j++
        ) {
            if (
                j === center
            ) {
                continue;
            }

            if (
                Number.isNaN(src[j]) ||
                src[j] >= value
            ) {
                pivot = false;
                break;
            }
        }

        if (pivot) {
            result[center] =
                value;
        }
    }

    return result;
}

// ================================================================
// Pivot Low
// ================================================================

export function pivotlow(
    src: readonly number[],
    leftBars: number,
    rightBars: number
): number[] {
    const n =
        src.length;

    const result =
        new Array<number>(n).fill(NaN);

    if (
        leftBars < 0 ||
        rightBars < 0
    ) {
        return result;
    }

    for (
        let center = leftBars;
        center <
            n - rightBars;
        center++
    ) {
        const value =
            src[center];

        if (Number.isNaN(value)) {
            continue;
        }

        let pivot = true;

        for (
            let j =
                center - leftBars;
            j <=
                center + rightBars;
            j++
        ) {
            if (
                j === center
            ) {
                continue;
            }

            if (
                Number.isNaN(src[j]) ||
                src[j] <= value
            ) {
                pivot = false;
                break;
            }
        }

        if (pivot) {
            result[center] =
                value;
        }
    }

    return result;
}

// ================================================================
// Linear Regression
// ================================================================

export function linreg(
    src: readonly number[],
    period: number,
    offset = 0
): number[] {
    const n =
        src.length;

    const result =
        new Array<number>(n).fill(NaN);

    if (
        !validPeriod(period)
    ) {
        return result;
    }

    const sumX =
        period *
        (period - 1) /
        2;

    const sumX2 =
        period *
        (period - 1) *
        (2 * period - 1) /
        6;

    const denominator =
        period * sumX2 -
        sumX * sumX;

    for (
        let i = period - 1;
        i < n;
        i++
    ) {
        let sumY = 0;
        let sumXY = 0;

        let valid = true;

        for (
            let j = 0;
            j < period;
            j++
        ) {
            const value =
                src[
                    i -
                    period +
                    1 +
                    j
                ];

            if (Number.isNaN(value)) {
                valid = false;
                break;
            }

            sumY += value;
            sumXY += j * value;
        }

        if (!valid) {
            continue;
        }

        const slope =
            (
                period *
                    sumXY -
                sumX *
                    sumY
            ) /
            denominator;

        const intercept =
            (
                sumY -
                slope * sumX
            ) / period;

        result[i] =
            slope *
                (
                    period -
                    1 -
                    offset
                ) +
            intercept;
    }

    return result;
}

// ================================================================
// Correlation
// ================================================================

export function correlation(
    x: readonly number[],
    y: readonly number[],
    period: number
): number[] {
    const n =
        Math.min(
            x.length,
            y.length
        );

    const result =
        new Array<number>(n).fill(NaN);

    if (
        !validPeriod(period)
    ) {
        return result;
    }

    for (
        let i = period - 1;
        i < n;
        i++
    ) {
        let sumX = 0;
        let sumY = 0;

        let valid = true;

        for (
            let j = i - period + 1;
            j <= i;
            j++
        ) {
            if (
                Number.isNaN(x[j]) ||
                Number.isNaN(y[j])
            ) {
                valid = false;
                break;
            }

            sumX += x[j];
            sumY += y[j];
        }

        if (!valid) {
            continue;
        }

        const meanX =
            sumX / period;

        const meanY =
            sumY / period;

        let numerator = 0;
        let varianceX = 0;
        let varianceY = 0;

        for (
            let j = i - period + 1;
            j <= i;
            j++
        ) {
            const dx =
                x[j] - meanX;

            const dy =
                y[j] - meanY;

            numerator +=
                dx * dy;

            varianceX +=
                dx * dx;

            varianceY +=
                dy * dy;
        }

        const denominator =
            Math.sqrt(
                varianceX *
                varianceY
            );

        result[i] =
            denominator === 0
                ? 0
                : numerator /
                    denominator;
    }

    return result;
}
