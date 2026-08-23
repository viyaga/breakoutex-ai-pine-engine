// ================================================================
// Pine Script Interpreter  (v3 — with MTF & Series Primitives)
// Evaluates a Pine Script v5 strategy, returns buy/sell/close signal.
// Zero external runtime dependencies.
// ================================================================

import { Candle, PineSignal } from '../config/types';
import * as ind from './indicators';

interface StrategyContext {
    signal:   PineSignal;
    position: 'long' | 'short' | 'none';
    opentrades: number;
    closedtrades: number;
    position_size: number;
}

/**
 * Wraps an array so it can be passed to functions as an array,
 * but also automatically dereferences to its last value in comparisons / math.
 */
export function wrapSeries<T extends any[]>(arr: T): T {
    if (!Array.isArray(arr)) return arr;
    (arr as any)[Symbol.toPrimitive] = function() {
        return this[this.length - 1];
    };
    return arr;
}

/**
 * Normalizes Pine Script timeframe representations to standard format.
 * Examples: "15" -> "15m", "60" -> "1h", "240" -> "4h", "D" -> "1d"
 */
export function normalizeTimeframe(tf: string | number): string {
    const s = String(tf).trim().toLowerCase();
    if (s === '1' || s === '1m') return '1m';
    if (s === '3' || s === '3m') return '3m';
    if (s === '5' || s === '5m') return '5m';
    if (s === '15' || s === '15m') return '15m';
    if (s === '30' || s === '30m') return '30m';
    if (s === '60' || s === '1h' || s === '60m') return '1h';
    if (s === '120' || s === '2h' || s === '120m') return '2h';
    if (s === '240' || s === '4h' || s === '240m') return '4h';
    if (s === 'd' || s === '1d' || s === '1440') return '1d';
    if (s === 'w' || s === '1w') return '1w';
    return s;
}

/**
 * Scans a Pine Script to extract all timeframes used in request.security calls.
 */
export function extractRequestedTimeframes(script: string, baseTimeframe = '5m'): string[] {
    const set = new Set<string>();
    set.add(normalizeTimeframe(baseTimeframe));

    const re = /request\.security\s*\(\s*[^,]+\s*,\s*["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(script)) !== null) {
        if (match[1]) set.add(normalizeTimeframe(match[1]));
    }
    return Array.from(set);
}

/**
 * Evaluate a Pine Script strategy on historical candles (supports single or multi-timeframe).
 */
export function evaluatePineScript(
    script: string,
    candlesInput: Candle[] | Map<string, Candle[]>,
    baseTimeframe = '5m'
): PineSignal {
    const candleMap: Map<string, Candle[]> = candlesInput instanceof Map
        ? candlesInput
        : new Map([[normalizeTimeframe(baseTimeframe), candlesInput]]);

    const baseTfNorm = normalizeTimeframe(baseTimeframe);
    const candles = candleMap.get(baseTfNorm) || Array.from(candleMap.values())[0] || [];

    if (!candles.length || !script.trim()) return { action: 'none' };

    const ctx: StrategyContext = {
        signal: { action: 'none' }, position: 'none',
        opentrades: 0, closedtrades: 0, position_size: 0,
    };

    // ── Base OHLCV series ─────────────────────────────────────────
    const open   = wrapSeries(candles.map(c => c.open));
    const high   = wrapSeries(candles.map(c => c.high));
    const low    = wrapSeries(candles.map(c => c.low));
    const close  = wrapSeries(candles.map(c => c.close));
    const volume = wrapSeries(candles.map(c => c.volume));
    const hl2    = wrapSeries(candles.map(c => (c.high + c.low) / 2));
    const hlc3   = wrapSeries(candles.map(c => (c.high + c.low + c.close) / 3));
    const ohlc4  = wrapSeries(candles.map(c => (c.open + c.high + c.low + c.close) / 4));
    const n      = candles.length;
    const last   = n - 1;

    // ── strategy namespace ────────────────────────────────────────
    const strategy = {
        long:  'long'  as const,
        short: 'short' as const,
        entry(id: string, dir: 'long' | 'short', ...rest: any[]) {
            let comment = id;
            if (typeof rest[0] === 'string') {
                comment = rest[0];
            } else if (typeof rest[0] === 'object' && rest[0]?.comment) {
                comment = rest[0].comment;
            }
            ctx.signal = dir === 'long'
                ? { action: 'buy',  comment }
                : { action: 'sell', comment };
            ctx.position = dir;
        },
        close(id?: string, comment?: string) {
            ctx.signal = { action: 'close', comment: comment ?? id };
        },
        exit(id: string, _from?: string, ...rest: any[]) {
            const first = rest[0];
            if (typeof first === 'object' && first !== null) {
                if (first.profit !== undefined) ctx.signal.tp = first.profit;
                if (first.limit  !== undefined) ctx.signal.tp = first.limit;
                if (first.loss   !== undefined) ctx.signal.sl = first.loss;
                if (first.stop   !== undefined) ctx.signal.sl = first.stop;
                if (first.comment) ctx.signal.comment = first.comment;
            } else {
                if (typeof rest[0] === 'number') ctx.signal.tp = rest[0];
                if (typeof rest[1] === 'number') ctx.signal.sl = rest[1];
                if (typeof rest[2] === 'string') ctx.signal.comment = rest[2];
            }
        },
        cancel(_id: string) {},
        order(_id: string, _dir: any, _qty?: number, _opts?: any) {},
        get opentrades()   { return ctx.opentrades; },
        get closedtrades() { return ctx.closedtrades; },
        get position_size(){ return ctx.position_size; },
        direction: { long: 'long', short: 'short', all: 'all' },
    };

    // ── Helper to build scoped TA namespace for any candle set ─────
    function buildTaNamespace(cList: Candle[]) {
        const _cache: Record<string, any> = {};
        const cached = <T>(key: string, fn: () => T): T =>
            key in _cache ? _cache[key] : (_cache[key] = fn());
        const curLast = cList.length - 1;

        return {
            ema:   (src: number[], p: number) => cached(`ema_${p}_${id(src)}`,  () => wrapSeries(ind.ema(src, p))),
            sma:   (src: number[], p: number) => cached(`sma_${p}_${id(src)}`,  () => wrapSeries(ind.sma(src, p))),
            wma:   (src: number[], p: number) => cached(`wma_${p}_${id(src)}`,  () => wrapSeries(ind.wma(src, p))),
            hma:   (src: number[], p: number) => cached(`hma_${p}_${id(src)}`,  () => wrapSeries(ind.hma(src, p))),
            dema:  (src: number[], p: number) => cached(`dema_${p}_${id(src)}`, () => wrapSeries(ind.dema(src, p))),
            tema:  (src: number[], p: number) => cached(`tema_${p}_${id(src)}`, () => wrapSeries(ind.tema(src, p))),
            rma:   (src: number[], p: number) => cached(`rma_${p}_${id(src)}`,  () => wrapSeries(ind.rma(src, p))),
            rsi:   (src: number[], p: number) => cached(`rsi_${p}_${id(src)}`,  () => wrapSeries(ind.rsi(src, p))),
            atr:   (p: number)               => cached(`atr_${p}`,             () => wrapSeries(ind.atr(cList, p))),
            cci:   (p?: number)              => cached(`cci_${p ?? 20}`,        () => wrapSeries(ind.cci(cList, p ?? 20))),
            macd: (src: number[], f = 12, s = 26, sig = 9) => {
                const r = cached(`macd_${f}_${s}_${sig}_${id(src)}`, () => ind.macd(src, f, s, sig));
                return [wrapSeries(r.macdLine), wrapSeries(r.signalLine), wrapSeries(r.histogram)];
            },
            bb: (src: number[], p = 20, m = 2) => {
                const r = cached(`bb_${p}_${m}_${id(src)}`, () => ind.bbands(src, p, m));
                return [wrapSeries(r.upper), wrapSeries(r.middle), wrapSeries(r.lower)];
            },
            bbands: (src: number[], p = 20, m = 2) => {
                const r = cached(`bb_${p}_${m}_${id(src)}`, () => ind.bbands(src, p, m));
                return r;
            },
            stoch: (src: number[], hi: number[], lo: number[], p: number) =>
                cached(`stoch_${p}_${id(src)}`, () => wrapSeries(ind.stoch(src, hi, lo, p))),
            stochRsi: (src: number[], rsiP: number, stochP: number, k: number, d: number) =>
                cached(`srsi_${rsiP}_${stochP}_${k}_${d}_${id(src)}`, () => {
                    const r = ind.stochRsi(src, rsiP, stochP, k, d);
                    return { k: wrapSeries(r.k), d: wrapSeries(r.d) };
                }),
            vwap: (_src?: number[]) => cached('vwap', () => wrapSeries(ind.vwap(cList))),
            adx:  (p?: number) => cached(`adx_${p ?? 14}`, () => {
                const r = ind.adx(cList, p ?? 14);
                return [wrapSeries(r.adx), wrapSeries(r.diPlus), wrapSeries(r.diMinus)];
            }),
            dmi:  (p?: number) => cached(`adx_${p ?? 14}`, () => {
                const r = ind.adx(cList, p ?? 14);
                return [wrapSeries(r.diPlus), wrapSeries(r.diMinus), wrapSeries(r.adx)];
            }),
            supertrend: (factor = 3, atrLen = 10) => cached(`st_${factor}_${atrLen}`, () => {
                const r = ind.supertrend(cList, atrLen, factor);
                return [wrapSeries(r.supertrend), wrapSeries(r.direction)];
            }),
            pivothigh: (src: number[], lb: number, rb: number) => wrapSeries(ind.pivothigh(src, lb, rb)),
            pivotlow:  (src: number[], lb: number, rb: number) => wrapSeries(ind.pivotlow(src, lb, rb)),
            highest:  (src: number[], p: number) => wrapSeries(ind.highest(src, p)),
            lowest:   (src: number[], p: number) => wrapSeries(ind.lowest(src, p)),
            crossover:  (a: number[], b: number[] | number) => ind.crossover(a, b as any, curLast),
            crossunder: (a: number[], b: number[] | number) => ind.crossunder(a, b as any, curLast),
            change:  (src: number[], l = 1) => wrapSeries(ind.change(src, l)),
            mom:     (src: number[], l: number) => wrapSeries(ind.mom(src, l)),
            stdev:   (src: number[], p: number) => wrapSeries(ind.stdev(src, p)),
            variance:(src: number[], p: number) => wrapSeries(ind.variance(src, p)),
            correlation:(x: number[], y: number[], p: number) => wrapSeries(ind.correlation(x, y, p)),
            linreg:  (src: number[], p: number, offset = 0) => wrapSeries(ind.linreg(src, p, offset)),
            sum:     (src: number[], p: number) => wrapSeries(ind.sum(src, p)),
            rising:  (src: number[], p: number) => ind.rising(src, p),
            falling: (src: number[], p: number) => ind.falling(src, p),
            barssince: (cond: boolean[]) => {
                let count = 0;
                for (let i = curLast; i >= 0; i--) {
                    if (cond[i]) return count;
                    count++;
                }
                return NaN;
            },
        };
    }

    const ta = buildTaNamespace(candles);

    // ── request namespace (Multi-Timeframe MTF support) ───────────
    const request = {
        security(_sym: string, tf: string | number, exprFn: any) {
            const normTf = normalizeTimeframe(tf);
            const htfCandles = candleMap.get(normTf) || candles;

            const htfOpen   = wrapSeries(htfCandles.map(c => c.open));
            const htfHigh   = wrapSeries(htfCandles.map(c => c.high));
            const htfLow    = wrapSeries(htfCandles.map(c => c.low));
            const htfClose  = wrapSeries(htfCandles.map(c => c.close));
            const htfVolume = wrapSeries(htfCandles.map(c => c.volume));
            const htfHL2    = wrapSeries(htfCandles.map(c => (c.high + c.low) / 2));
            const htfHLC3   = wrapSeries(htfCandles.map(c => (c.high + c.low + c.close) / 3));
            const htfOHLC4  = wrapSeries(htfCandles.map(c => (c.open + c.high + c.low + c.close) / 4));
            const htfLast   = htfCandles.length - 1;
            const htfTa     = buildTaNamespace(htfCandles);

            if (typeof exprFn === 'function') {
                const res = exprFn(
                    htfClose, htfHigh, htfLow, htfOpen, htfVolume,
                    htfHL2, htfHLC3, htfOHLC4,
                    htfTa, math, htfLast
                );
                if (Array.isArray(res)) return res[htfLast];
                return res;
            }
            return exprFn;
        },
    };

    // ── input.* namespace ─────────────────────────────────────────
    const input = {
        int:    (def: number)  => def,
        float:  (def: number)  => def,
        bool:   (def: boolean) => def,
        string: (def: string)  => def,
        source: (def: number[]) => def,
        color:  (_def: any)    => '#000000',
        price:  (def: number)  => def,
        timeframe: (def: string) => def,
    };

    // ── color namespace ───────────────────────────────────────────
    const color = {
        red: '#FF0000', green: '#00FF00', blue: '#0000FF',
        white: '#FFFFFF', black: '#000000', gray: '#808080',
        yellow: '#FFFF00', orange: '#FFA500', purple: '#800080',
        lime: '#00FF00', navy: '#000080', teal: '#008080', maroon: '#800000',
        aqua: '#00FFFF', fuchsia: '#FF00FF',
        new: (r: number, g: number, b: number, _t?: number) => `rgb(${r},${g},${b})`,
        from_gradient: () => '#888888',
    };

    // ── syminfo / timeframe stubs ─────────────────────────────────
    const syminfo = {
        ticker: 'BTCUSDT', tickerid: 'BTCUSDT',
        mintick: 0.01, minmove: 1, pricescale: 100,
        basecurrency: 'BTC', currency: 'USDT',
        type: 'crypto', prefix: '',
        pointvalue: 1, session: 'regular', timezone: 'UTC',
    };
    const timeframe = {
        period: baseTfNorm, multiplier: parseInt(baseTfNorm) || 5, isdwm: false,
        isminutes: true, isseconds: false, isdays: false,
        isweekly: false, ismonthly: false, isintraday: true,
        change: (_tf: string) => false,
        in_seconds: (_tf?: string) => 300,
    };

    // ── nz / na helpers ──────────────────────────────────────────
    const nz  = (v: any, rep: any = 0) => (v == null || (typeof v === 'number' && isNaN(v))) ? rep : v;
    const na  = (v: any) => v == null || (typeof v === 'number' && isNaN(v));
    const fixnan = (v: number, rep = 0) => isNaN(v) ? rep : v;

    // ── math helpers ─────────────────────────────────────────────
    const math = {
        ...Math,
        abs: Math.abs, ceil: Math.ceil, floor: Math.floor,
        log: Math.log, log10: Math.log10, max: Math.max, min: Math.min,
        pow: Math.pow, round: Math.round, sign: Math.sign, sqrt: Math.sqrt,
        sin: Math.sin, cos: Math.cos, tan: Math.tan,
        pi: Math.PI, phi: 1.618033988749895,
        tostring: (v: number, dec?: number) => dec !== undefined ? v.toFixed(dec) : String(v),
    };

    // ── Cache key id helper ──────────────────────────────────────
    function id(arr: number[]): number {
        if (arr === close)  return 0;
        if (arr === open)   return 1;
        if (arr === high)   return 2;
        if (arr === low)    return 3;
        if (arr === volume) return 4;
        if (arr === hl2)    return 5;
        if (arr === hlc3)   return 6;
        if (arr === ohlc4)  return 7;
        return arr.length + (arr[0] ?? 0) + (arr[arr.length - 1] ?? 0);
    }

    // ── Execute ───────────────────────────────────────────────────
    try {
        const cleaned = transformPineToJs(script, last);
        const fn = new Function(
            'strategy','ta','request','input','color','math','syminfo','timeframe',
            'nz','na','fixnan',
            'open','high','low','close','volume',
            'hl2','hlc3','ohlc4',
            'bar_index','last',
            cleaned
        );
        fn(
            strategy,ta,request,input,color,math,syminfo,timeframe,
            nz,na,fixnan,
            open,high,low,close,volume,
            hl2,hlc3,ohlc4,
            last,last
        );
    } catch (err: any) {
        console.error('[PineInterpreter] Error:', err.message?.slice(0, 200));
    }

    // ── Confluence Score Calculation ──────────────────────────────
    if (ctx.signal.action === 'buy' || ctx.signal.action === 'sell') {
        if (!ctx.signal.score) {
            let score = 50; // Base score for valid signal trigger

            const rsiArr = ind.rsi(close, 14);
            const currentRsi = rsiArr[last] || 50;

            const ema20Arr = ind.ema(close, Math.min(20, Math.floor(n / 2)));
            const ema50Arr = ind.ema(close, Math.min(50, Math.floor(n / 2)));
            const currentEma20 = ema20Arr[last] || close[last];
            const currentEma50 = ema50Arr[last] || close[last];
            const currentPrice = close[last];

            // 1. RSI Confluence (+15)
            if (ctx.signal.action === 'buy' && currentRsi >= 45 && currentRsi <= 70) {
                score += 15;
            } else if (ctx.signal.action === 'sell' && currentRsi <= 55 && currentRsi >= 30) {
                score += 15;
            }

            // 2. Trend Confluence (+20)
            if (ctx.signal.action === 'buy' && currentPrice > currentEma20 && currentEma20 >= currentEma50) {
                score += 20;
            } else if (ctx.signal.action === 'sell' && currentPrice < currentEma20 && currentEma20 <= currentEma50) {
                score += 20;
            }

            // 3. Volume Confluence (+15)
            const volSma = ind.sma(volume, Math.min(20, n));
            const currentVol = volume[last];
            const avgVol = volSma[last] || currentVol;
            if (currentVol > avgVol * 1.1) {
                score += 15;
            }

            ctx.signal.score = Math.min(100, Math.max(0, score));
        }
    }

    return ctx.signal;
}

// ================================================================
// Pine → JS Transformer
// ================================================================
export function transformPineToJs(script: string, _last: number): string {
    let s = script;

    // 1. Remove version comment
    s = s.replace(/\/\/@version=\d+\n?/g, '');

    // 2. Remove multi-line strategy/indicator/study declarations
    s = removeMultiLineCalls(s, ['strategy', 'indicator', 'study', 'library']);

    // 3. Remove display-only calls
    s = removeMultiLineCalls(s, [
        'plot','plotshape','plotchar','plotarrow','plotbar','plotcandle',
        'bgcolor','barcolor','alertcondition','alert',
        'label.new','label.set_text','label.set_color','label.delete','label.set_xy',
        'line.new','line.set_color','line.delete','line.set_xy1','line.set_xy2',
        'box.new','box.delete','table.new','table.cell',
        'hline',
    ]);

    // 4. Transform request.security(sym, tf, expr) -> request.security(sym, tf, (close, high, low, open, volume, hl2, hlc3, ohlc4, ta, math, last) => (expr))
    s = s.replace(/request\.security\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)/g,
        (_match, sym, tf, expr) => {
            return `request.security(${sym}, ${tf}, (close, high, low, open, volume, hl2, hlc3, ohlc4, ta, math, last) => (${expr}))`;
        }
    );

    // 5. Convert Pine series[N] offset access -> array[last - N]
    s = s.replace(/(\w+)\[(\d+)\]/g, (_, name, offset) => {
        const n = parseInt(offset);
        if (n === 0) return `${name}[last]`;
        return `${name}[last - ${n}]`;
    });

    // 6. var type declarations
    s = s.replace(/\bvar\s+(float|int|bool|string|color|line|label|array<\w+>)\s+/g, 'let ');
    s = s.replace(/\bvar\s+/g, 'let ');

    // 7. Inline type declarations
    s = s.replace(/\b(float|int|bool|string|color)\s+(\w+)\s*(?==)/g, 'let $2 ');

    // 8. Auto-prefix `let ` on variable declarations
    s = s.replace(/:=/g, ' __REASSIGN__ ');
    s = s.replace(/^([ \t]*)(?!(?:let|const|var|if|else|for|while|return|function)\b)([a-zA-Z_]\w*)\s*=(?!=)/gm, '$1let $2 =');
    s = s.replace(/^([ \t]*)\[([a-zA-Z0-9_,\s]+)\]\s*=(?!=)/gm, '$1let [$2] =');
    s = s.replace(/__REASSIGN__/g, '=');

    // 9. Pine logical operators -> JS
    s = s.replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b/g, '!');

    // 10. Indentation blocks -> JS braces
    s = convertIndentationToBraces(s);

    // 11. Remove type annotations in func params
    s = s.replace(/\((float|int|bool|string)\s+(\w+)/g, '($2');
    s = s.replace(/,\s*(float|int|bool|string)\s+(\w+)/g, ', $2');

    return s;
}

function removeMultiLineCalls(src: string, fnNames: string[]): string {
    for (const fn of fnNames) {
        const re = new RegExp(`^[ \\t]*${escapeRe(fn)}\\s*\\(`, 'gm');
        let match: RegExpExecArray | null;
        while ((match = re.exec(src)) !== null) {
            const start = match.index;
            let depth = 0;
            let i = src.indexOf('(', start + match[0].length - 1);
            if (i === -1) continue;
            const end = findMatchingParen(src, i);
            if (end === -1) continue;
            src = src.slice(0, start) + src.slice(end + 1).replace(/^\s*\n/, '\n');
            re.lastIndex = start;
        }
    }
    return src;
}

function findMatchingParen(src: string, openIdx: number): number {
    let depth = 1;
    for (let i = openIdx + 1; i < src.length; i++) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') { depth--; if (depth === 0) return i; }
    }
    return -1;
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function convertIndentationToBraces(src: string): string {
    const lines = src.split('\n');
    const result: string[] = [];
    const stack: number[] = [-1];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const stripped = line.trimEnd();
        if (stripped === '') { result.push(line); continue; }

        const indent = line.search(/\S/);

        while (stack.length > 1 && stack[stack.length - 1] >= indent) {
            stack.pop();
            result.push(' '.repeat(Math.max(0, stack[stack.length - 1] + 4)) + '}');
        }

        const trimmed = stripped.trimStart();
        const opensBlock =
            /^if\s/.test(trimmed) ||
            /^else\s*if\s/.test(trimmed) ||
            /^else\s*$/.test(trimmed) ||
            /^for\s/.test(trimmed) ||
            /^while\s/.test(trimmed) ||
            /^switch\s/.test(trimmed);

        if (opensBlock) {
            let nextIndent = -1;
            for (let j = i + 1; j < lines.length; j++) {
                const nl = lines[j];
                if (nl.trim() === '') continue;
                nextIndent = nl.search(/\S/);
                break;
            }

            if (nextIndent > indent) {
                let converted = trimmed;
                if (/^if\s/.test(converted)) {
                    const cond = converted.replace(/^if\s+/, '');
                    converted = cond.startsWith('(') ? `if ${cond} {` : `if (${cond}) {`;
                } else if (/^else\s+if\s/.test(converted)) {
                    const cond = converted.replace(/^else\s+if\s+/, '');
                    converted = cond.startsWith('(') ? `else if ${cond} {` : `else if (${cond}) {`;
                } else if (/^else\s*$/.test(converted)) {
                    converted = 'else {';
                }
                result.push(' '.repeat(indent) + converted);
                stack.push(indent);
                continue;
            }
        }

        result.push(line);
    }

    while (stack.length > 1) {
        stack.pop();
        result.push(' '.repeat(Math.max(0, stack[stack.length - 1] + 4)) + '}');
    }

    return result.join('\n');
}
