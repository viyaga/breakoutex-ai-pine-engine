import { Candle } from '../config/types';

// ================================================================
// PINE SCRIPT INDICATOR LIBRARY  (v2 — audited & fixed)
// Zero external dependencies. Pure TypeScript, blazing fast.
// ================================================================

// ── EMA ─────────────────────────────────────────────────────────
export function ema(src: number[], period: number): number[] {
    if (!src.length || period <= 0) return src.map(() => NaN);
    const k = 2 / (period + 1);
    const result: number[] = new Array(src.length).fill(NaN);
    let start = 0;
    while (start < src.length && isNaN(src[start])) start++;
    if (start >= src.length) return result;
    result[start] = src[start];
    for (let i = start + 1; i < src.length; i++) {
        result[i] = isNaN(src[i]) ? result[i - 1] : src[i] * k + result[i - 1] * (1 - k);
    }
    return result;
}

// ── SMA ─────────────────────────────────────────────────────────
export function sma(src: number[], period: number): number[] {
    const result: number[] = new Array(src.length).fill(NaN);
    for (let i = period - 1; i < src.length; i++) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += src[j];
        result[i] = sum / period;
    }
    return result;
}

// ── WMA (Weighted MA) ────────────────────────────────────────────
export function wma(src: number[], period: number): number[] {
    const result: number[] = new Array(src.length).fill(NaN);
    const weight = (period * (period + 1)) / 2;
    for (let i = period - 1; i < src.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) sum += src[i - j] * (period - j);
        result[i] = sum / weight;
    }
    return result;
}

// ── HMA (Hull MA) ────────────────────────────────────────────────
export function hma(src: number[], period: number): number[] {
    const half = Math.floor(period / 2);
    const sqrtP = Math.round(Math.sqrt(period));
    const wma1 = wma(src, half);
    const wma2 = wma(src, period);
    const diff = wma1.map((v, i) => 2 * v - wma2[i]);
    return wma(diff, sqrtP);
}

// ── DEMA (Double EMA) ────────────────────────────────────────────
export function dema(src: number[], period: number): number[] {
    const e1 = ema(src, period);
    const e2 = ema(e1, period);
    return e1.map((v, i) => 2 * v - e2[i]);
}

// ── TEMA (Triple EMA) ────────────────────────────────────────────
export function tema(src: number[], period: number): number[] {
    const e1 = ema(src, period);
    const e2 = ema(e1, period);
    const e3 = ema(e2, period);
    return e1.map((v, i) => 3 * v - 3 * e2[i] + e3[i]);
}

// ── RMA (Wilder's smoothing — used by RSI/ATR) ──────────────────
export function rma(src: number[], period: number): number[] {
    if (!src.length) return [];
    const result: number[] = new Array(src.length).fill(NaN);
    // Find first index where we have `period` non-NaN values
    let seedSum = 0;
    let count   = 0;
    let seedEnd = -1;
    for (let i = 0; i < src.length; i++) {
        if (!isNaN(src[i])) {
            seedSum += src[i];
            count++;
            if (count === period) { seedEnd = i; break; }
        }
    }
    if (seedEnd === -1) return result;
    result[seedEnd] = seedSum / period;
    for (let i = seedEnd + 1; i < src.length; i++) {
        const v = isNaN(src[i]) ? result[i - 1] : src[i];
        result[i] = (result[i - 1] * (period - 1) + v) / period;
    }
    return result;
}

// ── ATR ─────────────────────────────────────────────────────────
export function atr(candles: Candle[], period: number): number[] {
    if (candles.length < 2) return candles.map(() => NaN);
    const tr: number[] = candles.map((c, i) => {
        if (i === 0) return c.high - c.low;
        const prev = candles[i - 1].close;
        return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
    });
    return rma(tr, period);
}

// ── RSI ─────────────────────────────────────────────────────────
export function rsi(src: number[], period: number): number[] {
    const gains: number[] = [0];
    const losses: number[] = [0];
    for (let i = 1; i < src.length; i++) {
        const diff = src[i] - src[i - 1];
        gains.push(diff > 0 ? diff : 0);
        losses.push(diff < 0 ? -diff : 0);
    }
    const avgGain = rma(gains, period);
    const avgLoss = rma(losses, period);
    return avgGain.map((g, i) => {
        const l = avgLoss[i];
        if (isNaN(g) || isNaN(l)) return NaN;
        if (l === 0) return 100;
        return 100 - 100 / (1 + g / l);
    });
}

// ── MACD ─────────────────────────────────────────────────────────
export function macd(src: number[], fast = 12, slow = 26, signal = 9): {
    macdLine: number[]; signalLine: number[]; histogram: number[];
} {
    const fastEma   = ema(src, fast);
    const slowEma   = ema(src, slow);
    const macdLine  = fastEma.map((f, i) => f - slowEma[i]);
    const signalLine = ema(macdLine, signal);
    const histogram  = macdLine.map((m, i) => m - signalLine[i]);
    return { macdLine, signalLine, histogram };
}

// ── Bollinger Bands ──────────────────────────────────────────────
export function bbands(src: number[], period = 20, mult = 2): {
    upper: number[]; middle: number[]; lower: number[];
    width: number[]; percentB: number[];
} {
    const middle = sma(src, period);
    const upper: number[]   = [];
    const lower: number[]   = [];
    const width: number[]   = [];
    const percentB: number[] = [];

    for (let i = 0; i < src.length; i++) {
        if (isNaN(middle[i])) {
            upper.push(NaN); lower.push(NaN); width.push(NaN); percentB.push(NaN);
            continue;
        }
        const slice = src.slice(i - period + 1, i + 1);
        const m = middle[i];
        const std = Math.sqrt(slice.reduce((acc, v) => acc + (v - m) ** 2, 0) / period);
        const u = m + mult * std;
        const l = m - mult * std;
        upper.push(u);
        lower.push(l);
        width.push((u - l) / m);
        percentB.push((src[i] - l) / (u - l));
    }
    return { upper, middle, lower, width, percentB };
}

// ── VWAP (resets at UTC midnight each day) ───────────────────────
export function vwap(candles: Candle[]): number[] {
    let cumVolume = 0;
    let cumTPV    = 0;
    let lastDay   = -1;
    return candles.map(c => {
        const day = Math.floor(c.timestamp / 86_400_000);
        if (day !== lastDay) { cumVolume = 0; cumTPV = 0; lastDay = day; }
        const tp = (c.high + c.low + c.close) / 3;
        cumTPV    += tp * c.volume;
        cumVolume += c.volume;
        return cumVolume === 0 ? NaN : cumTPV / cumVolume;
    });
}

// ── CCI (Commodity Channel Index) ────────────────────────────────
export function cci(candles: Candle[], period = 20): number[] {
    const tp    = candles.map(c => (c.high + c.low + c.close) / 3);
    const tpSma = sma(tp, period);
    return tp.map((v, i) => {
        if (isNaN(tpSma[i])) return NaN;
        const slice = tp.slice(i - period + 1, i + 1);
        const mean  = tpSma[i];
        const mad   = slice.reduce((acc, x) => acc + Math.abs(x - mean), 0) / period;
        return mad === 0 ? 0 : (v - mean) / (0.015 * mad);
    });
}

// ── Stochastic (%K) ───────────────────────────────────────────────
export function stoch(src: number[], hi: number[], lo: number[], period: number): number[] {
    return src.map((v, i) => {
        if (i < period - 1) return NaN;
        const hh = Math.max(...hi.slice(i - period + 1, i + 1));
        const ll = Math.min(...lo.slice(i - period + 1, i + 1));
        return hh === ll ? 0 : (v - ll) / (hh - ll) * 100;
    });
}

// ── Stochastic RSI ────────────────────────────────────────────────
export function stochRsi(src: number[], rsiPeriod = 14, stochPeriod = 14, smoothK = 3, smoothD = 3): {
    k: number[]; d: number[];
} {
    const rsiArr = rsi(src, rsiPeriod);
    const stochArr: number[] = rsiArr.map((v, i) => {
        if (i < stochPeriod - 1 || isNaN(v)) return NaN;
        const slice = rsiArr.slice(i - stochPeriod + 1, i + 1).filter(x => !isNaN(x));
        if (!slice.length) return NaN;
        const lo = Math.min(...slice);
        const hi = Math.max(...slice);
        return hi === lo ? 0 : (v - lo) / (hi - lo) * 100;
    });
    const k = sma(stochArr, smoothK);
    const d = sma(k, smoothD);
    return { k, d };
}

// ── ADX / DMI ────────────────────────────────────────────────────
export function adx(candles: Candle[], period = 14): {
    adx: number[]; diPlus: number[]; diMinus: number[];
} {
    const n = candles.length;
    const trArr: number[]     = new Array(n).fill(NaN);
    const dmPlus: number[]    = new Array(n).fill(0);
    const dmMinus: number[]   = new Array(n).fill(0);

    for (let i = 1; i < n; i++) {
        const c = candles[i], p = candles[i - 1];
        trArr[i]   = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
        const upMove   = c.high - p.high;
        const downMove = p.low - c.low;
        dmPlus[i]  = (upMove > downMove && upMove > 0) ? upMove  : 0;
        dmMinus[i] = (downMove > upMove && downMove > 0) ? downMove : 0;
    }

    const smoothTR    = rma(trArr,   period);
    const smoothPlus  = rma(dmPlus,  period);
    const smoothMinus = rma(dmMinus, period);

    const diPlus  = smoothPlus.map((v, i)  => smoothTR[i] ? (v / smoothTR[i]) * 100 : NaN);
    const diMinus = smoothMinus.map((v, i) => smoothTR[i] ? (v / smoothTR[i]) * 100 : NaN);
    const dx      = diPlus.map((p, i) => {
        const sum = p + diMinus[i];
        return sum === 0 ? 0 : (Math.abs(p - diMinus[i]) / sum) * 100;
    });
    const adxArr = rma(dx, period);

    return { adx: adxArr, diPlus, diMinus };
}

// ── Supertrend ───────────────────────────────────────────────────
export function supertrend(candles: Candle[], atrPeriod = 10, multiplier = 3): {
    supertrend: number[]; direction: number[]; // 1=up(bull), -1=down(bear)
} {
    const atrArr = atr(candles, atrPeriod);
    const hl2Arr = candles.map(c => (c.high + c.low) / 2);
    const n = candles.length;

    const upperBand: number[] = new Array(n).fill(NaN);
    const lowerBand: number[] = new Array(n).fill(NaN);
    const supertrendArr: number[] = new Array(n).fill(NaN);
    const direction: number[]     = new Array(n).fill(1);

    for (let i = atrPeriod; i < n; i++) {
        const basicUpper = hl2Arr[i] + multiplier * atrArr[i];
        const basicLower = hl2Arr[i] - multiplier * atrArr[i];

        upperBand[i] = (i > 0 && basicUpper < (upperBand[i - 1] ?? basicUpper)) || candles[i - 1]?.close > (upperBand[i - 1] ?? 0)
            ? basicUpper : upperBand[i - 1] ?? basicUpper;
        lowerBand[i] = (i > 0 && basicLower > (lowerBand[i - 1] ?? basicLower)) || candles[i - 1]?.close < (lowerBand[i - 1] ?? 0)
            ? basicLower : lowerBand[i - 1] ?? basicLower;

        if (i === atrPeriod) { direction[i] = 1; supertrendArr[i] = lowerBand[i]; continue; }

        if (direction[i - 1] === -1 && candles[i].close > upperBand[i]) {
            direction[i] = 1;
        } else if (direction[i - 1] === 1 && candles[i].close < lowerBand[i]) {
            direction[i] = -1;
        } else {
            direction[i] = direction[i - 1];
        }
        supertrendArr[i] = direction[i] === 1 ? lowerBand[i] : upperBand[i];
    }
    return { supertrend: supertrendArr, direction };
}

// ── Pivot High / Low ─────────────────────────────────────────────
export function pivothigh(src: number[], leftBars: number, rightBars: number): number[] {
    const result: number[] = new Array(src.length).fill(NaN);
    for (let i = leftBars; i < src.length - rightBars; i++) {
        const v = src[i];
        let isPivot = true;
        for (let j = i - leftBars; j <= i + rightBars; j++) {
            if (j !== i && src[j] >= v) { isPivot = false; break; }
        }
        if (isPivot) result[i] = v;
    }
    return result;
}
export function pivotlow(src: number[], leftBars: number, rightBars: number): number[] {
    const result: number[] = new Array(src.length).fill(NaN);
    for (let i = leftBars; i < src.length - rightBars; i++) {
        const v = src[i];
        let isPivot = true;
        for (let j = i - leftBars; j <= i + rightBars; j++) {
            if (j !== i && src[j] <= v) { isPivot = false; break; }
        }
        if (isPivot) result[i] = v;
    }
    return result;
}

// ── Highest / Lowest ─────────────────────────────────────────────
export function highest(src: number[], period: number): number[] {
    return src.map((_, i) => {
        if (i < period - 1) return NaN;
        return Math.max(...src.slice(i - period + 1, i + 1).filter(v => !isNaN(v)));
    });
}
export function lowest(src: number[], period: number): number[] {
    return src.map((_, i) => {
        if (i < period - 1) return NaN;
        return Math.min(...src.slice(i - period + 1, i + 1).filter(v => !isNaN(v)));
    });
}

// ── Crossover / Crossunder ───────────────────────────────────────
export function crossover(a: number[], b: number[], i: number): boolean {
    if (i < 1) return false;
    const bVal = typeof b === 'number' ? b : (b as number[])[i];
    const bPrev = typeof b === 'number' ? b : (b as number[])[i - 1];
    return a[i - 1] <= bPrev && a[i] > bVal;
}
export function crossunder(a: number[], b: number[], i: number): boolean {
    if (i < 1) return false;
    const bVal = typeof b === 'number' ? b : (b as number[])[i];
    const bPrev = typeof b === 'number' ? b : (b as number[])[i - 1];
    return a[i - 1] >= bPrev && a[i] < bVal;
}

// ── Change / Momentum ─────────────────────────────────────────────
export function change(src: number[], length = 1): number[] {
    return src.map((v, i) => i < length ? NaN : v - src[i - length]);
}
export function mom(src: number[], length: number): number[] { return change(src, length); }

// ── Standard Deviation ────────────────────────────────────────────
export function stdev(src: number[], period: number): number[] {
    const m = sma(src, period);
    return m.map((mean, i) => {
        if (isNaN(mean)) return NaN;
        const slice = src.slice(i - period + 1, i + 1);
        return Math.sqrt(slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period);
    });
}

// ── Variance ─────────────────────────────────────────────────────
export function variance(src: number[], period: number): number[] {
    return stdev(src, period).map(v => v ** 2);
}

// ── Correlation ──────────────────────────────────────────────────
export function correlation(x: number[], y: number[], period: number): number[] {
    const result: number[] = new Array(x.length).fill(NaN);
    for (let i = period - 1; i < x.length; i++) {
        const sx = x.slice(i - period + 1, i + 1);
        const sy = y.slice(i - period + 1, i + 1);
        const mx = sx.reduce((a, v) => a + v, 0) / period;
        const my = sy.reduce((a, v) => a + v, 0) / period;
        let num = 0, dx = 0, dy = 0;
        for (let j = 0; j < period; j++) {
            num += (sx[j] - mx) * (sy[j] - my);
            dx  += (sx[j] - mx) ** 2;
            dy  += (sy[j] - my) ** 2;
        }
        result[i] = (dx === 0 || dy === 0) ? 0 : num / Math.sqrt(dx * dy);
    }
    return result;
}

// ── Linreg (linear regression value) ────────────────────────────
export function linreg(src: number[], period: number, offset = 0): number[] {
    const result: number[] = new Array(src.length).fill(NaN);
    for (let i = period - 1; i < src.length; i++) {
        const slice = src.slice(i - period + 1, i + 1);
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let j = 0; j < period; j++) {
            sumX  += j; sumY += slice[j];
            sumXY += j * slice[j]; sumX2 += j * j;
        }
        const denom = period * sumX2 - sumX * sumX;
        if (denom === 0) { result[i] = slice[period - 1]; continue; }
        const m = (period * sumXY - sumX * sumY) / denom;
        const b = (sumY - m * sumX) / period;
        result[i] = m * (period - 1 - offset) + b;
    }
    return result;
}

// ── Sum ───────────────────────────────────────────────────────────
export function sum(src: number[], period: number): number[] {
    const result: number[] = new Array(src.length).fill(NaN);
    for (let i = period - 1; i < src.length; i++) {
        result[i] = src.slice(i - period + 1, i + 1).reduce((a, v) => a + v, 0);
    }
    return result;
}

// ── Rising / Falling ─────────────────────────────────────────────
export function rising(src: number[], period: number): boolean[] {
    return src.map((v, i) => i >= period && v > src[i - period]);
}
export function falling(src: number[], period: number): boolean[] {
    return src.map((v, i) => i >= period && v < src[i - period]);
}
