// ================================================================
// Pine Script Interpreter  (v3 — with MTF & Series Primitives)
// Evaluates a Pine Script v5 strategy, returns buy/sell/close signal.
// Zero external runtime dependencies.
// ================================================================

import { Candle, PineSignal } from '../config/types';
import * as ind from './indicators';
import { PineExecutionContext } from './PineExecutionContext';
import { CompiledPineScript, PineScriptCompiler } from './CompiledPineScript';

const defaultCompiler = new PineScriptCompiler();

interface StrategyContext {
    signal:   PineSignal;
    position: 'long' | 'short' | 'none';
    opentrades: number;
    closedtrades: number;
    position_size: number;
}

/**
 * Wraps an array so it can be passed to functions as an array,
 * but also automatically dereferences to its last (or indexed) value in comparisons / math.
 */
export function wrapSeries<T extends any[]>(
    arr: T,
    currentIndex?: number,
    seriesType?: 'close' | 'open' | 'high' | 'low' | 'volume'
): T {
    if (!Array.isArray(arr)) return arr;
    if (seriesType) {
        (arr as any)._seriesType = seriesType;
    }
    const idx = currentIndex !== undefined ? currentIndex : arr.length - 1;
    (arr as any).valueOf = function() {
        return this[idx];
    };
    (arr as any)[Symbol.toPrimitive] = function() {
        return this[idx];
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
 * Converts any timeframe string to total minutes.
 */
export function parseTimeframeToMinutes(tf: string | number): number {
    const s = normalizeTimeframe(tf);
    if (s.endsWith('m')) return parseInt(s) || 5;
    if (s.endsWith('h')) return (parseInt(s) || 1) * 60;
    if (s.endsWith('d')) return (parseInt(s) || 1) * 1440;
    if (s.endsWith('w')) return (parseInt(s) || 1) * 10080;
    return parseInt(s) || 5;
}

export interface DataSufficiencyRequirement {
    requiredBaseCandles: number;
    requiredDays: number;
    limitingFactor: string;
    indicatorsDetected: { timeframe: string; indicator: string; period: number; requiredBaseBars: number }[];
}

/**
 * Mathematically calculates the exact minimum required base candle count
 * needed to fully warm up all HTF and base indicators in a Pine Script.
 */
export function analyzeDataSufficiency(
    script: string,
    baseTimeframe = '5m',
    candleMap?: Map<string, Candle[]> | Record<string, any[]>,
    baseCandlesCount?: number
): DataSufficiencyRequirement & { isSufficient: boolean } {
    const baseMinutes = parseTimeframeToMinutes(baseTimeframe);
    const indicators: { timeframe: string; indicator: string; period: number; requiredBaseBars: number; hasDirectHTF: boolean; directHTFOk: boolean }[] = [];

    // 1. Scan for request.security calls (supporting multiline arguments)
    const secRegex = /request\.security\s*\(\s*[\s\S]*?,\s*["']([^"']+)["']\s*,\s*([\s\S]*?)(?:,\s*(?:lookahead|gaps|\w+)\s*=|\))/g;
    let match: RegExpExecArray | null;
    while ((match = secRegex.exec(script)) !== null) {
        const tf = match[1];
        const rawExpr = match[2].trim();
        const tfMinutes = parseTimeframeToMinutes(tf);
        const ratio = Math.max(1, tfMinutes / baseMinutes);

        // Find periods inside expr (e.g. ema(close, 200), highest(high, 20), ema(close, structureLen))
        const periodMatch = rawExpr.match(/(?:ta\.\w+|\w+)\s*\([^,)]+,\s*(\d+)/) || rawExpr.match(/(?:ta\.\w+|\w+)\s*\(\s*(\d+)/);
        let period = periodMatch ? parseInt(periodMatch[1]) : 20;

        // Check if length is variable name like structureLen or fastLen
        if (!periodMatch) {
            const varMatch = rawExpr.match(/(?:ta\.\w+|\w+)\s*\([^,)]+,\s*([a-zA-Z_]\w*)/);
            if (varMatch && varMatch[1]) {
                const varName = varMatch[1];
                const inputDecl = script.match(new RegExp(`${varName}\\s*=\\s*input\\.(?:int|float)\\s*\\(\\s*(\\d+)`));
                if (inputDecl) period = parseInt(inputDecl[1]);
            }
        }

        const normTf = normalizeTimeframe(tf);
        const explicitHtf = candleMap instanceof Map
            ? candleMap.get(normTf)
            : (candleMap as any)?.[normTf] || (candleMap as any)?.[tf];
        const hasDirectHTF = Boolean(explicitHtf && explicitHtf.length > 0);
        const directHTFOk = hasDirectHTF && (explicitHtf!.length >= period + 5);

        const requiredBaseBars = hasDirectHTF ? period + 10 : Math.ceil(period * ratio) + 10;

        indicators.push({
            timeframe: tf,
            indicator: rawExpr.replace(/\s+/g, ' '),
            period,
            requiredBaseBars,
            hasDirectHTF,
            directHTFOk,
        });
    }

    // 2. Scan for base indicators
    const baseIndRegex = /ta\.(ema|sma|rsi|atr|highest|lowest|stoch|bb|bollinger|keltner|donchian)\s*\([^,)]+,\s*(\d+)/g;
    while ((match = baseIndRegex.exec(script)) !== null) {
        const indName = match[1];
        const period = parseInt(match[2]);
        indicators.push({
            timeframe: baseTimeframe,
            indicator: `ta.${indName}(${period})`,
            period,
            requiredBaseBars: period + 10,
            hasDirectHTF: false,
            directHTFOk: false,
        });
    }

    let maxRequired = 50; // baseline minimum
    let limiting = 'Baseline strategy warmup';
    let allDirectOk = true;

    for (const ind of indicators) {
        if (ind.hasDirectHTF && !ind.directHTFOk) {
            allDirectOk = false;
            limiting = `Explicit ${ind.timeframe} feed has insufficient bars for ${ind.indicator} (requires ${ind.period + 5} bars)`;
        }
        if (ind.requiredBaseBars > maxRequired) {
            maxRequired = ind.requiredBaseBars;
            limiting = `${ind.timeframe} ${ind.indicator} (requires ${ind.period} ${ind.timeframe} bars = ${ind.requiredBaseBars.toLocaleString()} base bars)`;
        }
    }

    const hasExplicitHtf = indicators.some((ind) => ind.hasDirectHTF);
    const isSufficient = hasExplicitHtf
        ? allDirectOk && (baseCandlesCount === undefined || baseCandlesCount >= 30)
        : baseCandlesCount === undefined || baseCandlesCount >= maxRequired;

    return {
        requiredBaseCandles: maxRequired,
        requiredDays: Number(((maxRequired * baseMinutes) / 1440).toFixed(1)),
        limitingFactor: limiting,
        indicatorsDetected: indicators,
        isSufficient,
    };
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

export interface PineEvaluationOptions {
    /**
     * If true, calculate the optional RSI/EMA/volume
     * confluence score.
     *
     * DEFAULT = false
     */
    calculateConfluenceScore?: boolean;

    /**
     * Precomputed execution context.
     * When supplied, indicators use precalculated series for fast O(1) execution.
     */
    executionContext?: PineExecutionContext;

    /**
     * Optional precompiled Pine script function.
     */
    compiledScript?: CompiledPineScript;

    /**
     * If true, use precompiled function execution.
     * Default: true.
     */
    useCompiledScript?: boolean;
}

/**
 * Evaluate a Pine Script strategy on historical candles (supports single or multi-timeframe).
 */
export function evaluatePineScript(
    script: string,
    candlesInput: Candle[] | Map<string, Candle[]>,
    baseTimeframe = '5m',
    options: PineEvaluationOptions = {}
): PineSignal {
    const calculateConfluence =
        options.calculateConfluenceScore ?? false;

    const execCtx = options.executionContext;

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
    const baseSeries = execCtx?.series?.get(baseTfNorm);
    const targetIndex = execCtx ? execCtx.currentBarIndex : (candles.length - 1);
    const last = targetIndex;

    const open   = baseSeries ? wrapSeries(baseSeries.open, targetIndex, 'open') : wrapSeries(candles.map(c => c.open), targetIndex, 'open');
    const high   = baseSeries ? wrapSeries(baseSeries.high, targetIndex, 'high') : wrapSeries(candles.map(c => c.high), targetIndex, 'high');
    const low    = baseSeries ? wrapSeries(baseSeries.low, targetIndex, 'low') : wrapSeries(candles.map(c => c.low), targetIndex, 'low');
    const close  = baseSeries ? wrapSeries(baseSeries.close, targetIndex, 'close') : wrapSeries(candles.map(c => c.close), targetIndex, 'close');
    const volume = baseSeries ? wrapSeries(baseSeries.volume, targetIndex, 'volume') : wrapSeries(candles.map(c => c.volume), targetIndex, 'volume');
    const hl2    = baseSeries ? wrapSeries(baseSeries.hl2, targetIndex) : wrapSeries(candles.map(c => (c.high + c.low) / 2), targetIndex);
    const hlc3   = baseSeries ? wrapSeries(baseSeries.hlc3, targetIndex) : wrapSeries(candles.map(c => (c.high + c.low + c.close) / 3), targetIndex);
    const ohlc4  = baseSeries ? wrapSeries(baseSeries.ohlc4, targetIndex) : wrapSeries(candles.map(c => (c.open + c.high + c.low + c.close) / 4), targetIndex);
    const n      = candles.length;

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
            ctx.signal =
                dir === 'long'
                    ? {
                        action: 'buy',
                        comment,
                        source: 'pine',
                        explicitScore: false,
                    }
                    : {
                        action: 'sell',
                        comment,
                        source: 'pine',
                        explicitScore: false,
                    };
            ctx.position = dir;
        },
        close(id?: string, comment?: string) {
            ctx.signal = {
                action: 'close',
                comment: comment ?? id,
                source: 'pine',
            };
        },
        close_all(comment?: string) {
            ctx.signal = {
                action: 'close',
                comment: comment ?? 'close_all',
                source: 'pine',
            };
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
            ctx.signal.source = 'pine';
        },
        cancel(_id: string) {},
        order(_id: string, _dir: any, _qty?: number, _opts?: any) {},
        get opentrades()   { return ctx.opentrades; },
        get closedtrades() { return ctx.closedtrades; },
        get position_size(){ return ctx.position_size; },
        direction: { long: 'long', short: 'short', all: 'all' },
    };

    function getSeriesType(src: number[]): 'close' | 'open' | 'high' | 'low' | undefined {
        const t = (src as any)?._seriesType;
        if (t === 'close' || t === 'open' || t === 'high' || t === 'low') return t;
        return undefined;
    }

    // ── Helper to build scoped TA namespace for any candle set ─────
    function buildTaNamespace(cList: Candle[], engine?: any, isBase = true, customTargetIndex?: number) {
        const _cache: Record<string, any> = {};
        const cached = <T>(key: string, fn: () => T): T =>
            key in _cache ? _cache[key] : (_cache[key] = fn());
        const localLast = customTargetIndex !== undefined ? customTargetIndex : (cList.length - 1);
        const targetIndex = (engine && isBase && execCtx) ? execCtx.currentBarIndex : localLast;

        return {
            ema: (src: number[], p: number) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    return cached(`ema_${p}_${type}`, () => wrapSeries(engine.ema(p, type), targetIndex));
                }
                return cached(`ema_${p}_${id(src)}`, () => wrapSeries(ind.ema(src, p), localLast));
            },
            sma: (src: number[], p: number) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    return cached(`sma_${p}_${type}`, () => wrapSeries(engine.sma(p, type), targetIndex));
                }
                return cached(`sma_${p}_${id(src)}`, () => wrapSeries(ind.sma(src, p), localLast));
            },
            wma: (src: number[], p: number) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    return cached(`wma_${p}_${type}`, () => wrapSeries(engine.wma(p, type), targetIndex));
                }
                return cached(`wma_${p}_${id(src)}`, () => wrapSeries(ind.wma(src, p), localLast));
            },
            hma: (src: number[], p: number) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    return cached(`hma_${p}_${type}`, () => wrapSeries(engine.hma(p, type), targetIndex));
                }
                return cached(`hma_${p}_${id(src)}`, () => wrapSeries(ind.hma(src, p), localLast));
            },
            dema: (src: number[], p: number) => cached(`dema_${p}_${id(src)}`, () => wrapSeries(ind.dema(src, p), localLast)),
            tema: (src: number[], p: number) => cached(`tema_${p}_${id(src)}`, () => wrapSeries(ind.tema(src, p), localLast)),
            rma: (src: number[], p: number) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    return cached(`rma_${p}_${type}`, () => wrapSeries(engine.rma(p, type), targetIndex));
                }
                return cached(`rma_${p}_${id(src)}`, () => wrapSeries(ind.rma(src, p), localLast));
            },
            rsi: (src: number[], p: number) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    return cached(`rsi_${p}_${type}`, () => wrapSeries(engine.rsi(p, type), targetIndex));
                }
                return cached(`rsi_${p}_${id(src)}`, () => wrapSeries(ind.rsi(src, p), localLast));
            },
            atr: (p: number) => {
                if (engine) {
                    return cached(`atr_${p}`, () => wrapSeries(engine.atr(p), targetIndex));
                }
                return cached(`atr_${p}`, () => wrapSeries(ind.atr(cList, p), localLast));
            },
            cci: (p?: number) => {
                if (engine) {
                    return cached(`cci_${p ?? 20}`, () => wrapSeries(engine.cci(p ?? 20), targetIndex));
                }
                return cached(`cci_${p ?? 20}`, () => wrapSeries(ind.cci(cList, p ?? 20), localLast));
            },
            macd: (src: number[], f = 12, s = 26, sig = 9) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    const r = cached(`macd_${f}_${s}_${sig}_${type}`, () => engine.macd(f, s, sig, type));
                    return [wrapSeries(r.macdLine, targetIndex), wrapSeries(r.signalLine, targetIndex), wrapSeries(r.histogram, targetIndex)];
                }
                const r = cached(`macd_${f}_${s}_${sig}_${id(src)}`, () => ind.macd(src, f, s, sig));
                return [wrapSeries(r.macdLine, localLast), wrapSeries(r.signalLine, localLast), wrapSeries(r.histogram, localLast)];
            },
            supertrend: (factor = 3, period = 10) => {
                if (engine) {
                    const r = cached(`st_${factor}_${period}`, () => engine.supertrend(factor, period));
                    return [wrapSeries(r.supertrend, targetIndex), wrapSeries(r.direction, targetIndex)];
                }
                const r = cached(`st_${factor}_${period}`, () => ind.supertrend(cList, period, factor));
                return [wrapSeries(r.supertrend, localLast), wrapSeries(r.direction, localLast)];
            },
            vwap: () => {
                if (engine) {
                    return cached('vwap', () => wrapSeries(engine.vwap(), targetIndex));
                }
                return cached('vwap', () => wrapSeries(ind.vwap(cList), localLast));
            },
            bollinger: (src: number[], p = 20, mult = 2) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    const r = cached(`bb_${p}_${mult}_${type}`, () => engine.bbands(p, mult, type));
                    return [wrapSeries(r.middle, targetIndex), wrapSeries(r.upper, targetIndex), wrapSeries(r.lower, targetIndex)];
                }
                const r = cached(`bb_${p}_${mult}_${id(src)}`, () => ind.bollinger(src, p, mult));
                return [wrapSeries(r.middle, localLast), wrapSeries(r.upper, localLast), wrapSeries(r.lower, localLast)];
            },
            bb: (src: number[], p = 20, mult = 2) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    const r = cached(`bb_${p}_${mult}_${type}`, () => engine.bbands(p, mult, type));
                    return [wrapSeries(r.middle, targetIndex), wrapSeries(r.upper, targetIndex), wrapSeries(r.lower, targetIndex)];
                }
                const r = cached(`bb_${p}_${mult}_${id(src)}`, () => ind.bollinger(src, p, mult));
                return [wrapSeries(r.middle, localLast), wrapSeries(r.upper, localLast), wrapSeries(r.lower, localLast)];
            },
            bbands: (src: number[], p = 20, mult = 2) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    const r = cached(`bb_${p}_${mult}_${type}`, () => engine.bbands(p, mult, type));
                    return [wrapSeries(r.middle, targetIndex), wrapSeries(r.upper, targetIndex), wrapSeries(r.lower, targetIndex)];
                }
                const r = cached(`bb_${p}_${mult}_${id(src)}`, () => ind.bollinger(src, p, mult));
                return [wrapSeries(r.middle, localLast), wrapSeries(r.upper, localLast), wrapSeries(r.lower, localLast)];
            },
            donchian: (p = 20) => {
                if (engine) {
                    const r = cached(`don_${p}`, () => engine.donchian(p));
                    return [wrapSeries(r.upper, targetIndex), wrapSeries(r.lower, targetIndex), wrapSeries(r.middle, targetIndex)];
                }
                const r = cached(`don_${p}`, () => ind.donchian(cList, p));
                return [wrapSeries(r.upper, localLast), wrapSeries(r.lower, localLast), wrapSeries(r.middle, localLast)];
            },
            keltner: (src: number[], p = 20, mult = 1.5, atrP = 10) => {
                if (engine) {
                    const r = cached(`kc_${p}_${mult}_${atrP}`, () => engine.keltner(p, mult, atrP));
                    return [wrapSeries(r.upper, targetIndex), wrapSeries(r.lower, targetIndex), wrapSeries(r.middle, targetIndex)];
                }
                const r = cached(`kc_${p}_${mult}_${atrP}_${id(src)}`, () => ind.keltner(cList, p, mult, atrP));
                return [wrapSeries(r.upper, localLast), wrapSeries(r.lower, localLast), wrapSeries(r.middle, localLast)];
            },
            stoch: (src: number[], high: number[], low: number[], p = 14) => {
                if (engine) {
                    return cached(`stoch_${p}`, () => wrapSeries(engine.stoch(p), targetIndex));
                }
                return wrapSeries(ind.stoch(high, low, src, p), localLast);
            },
            stochRsi: (src: number[], rsiP = 14, stochP = 14, k = 3, d = 3) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    const r = cached(`srsi_${rsiP}_${stochP}_${k}_${d}_${type}`, () => engine.stochRsi(rsiP, stochP, k, d, type));
                    return [wrapSeries(r.k, targetIndex), wrapSeries(r.d, targetIndex)];
                }
                const r = cached(`srsi_${rsiP}_${stochP}_${k}_${d}_${id(src)}`, () => ind.stochRsi(src, rsiP, stochP, k, d));
                return [wrapSeries(r.k, localLast), wrapSeries(r.d, localLast)];
            },
            mfi: (src: number[], vol: number[], p = 14) => {
                if (engine) {
                    return cached(`mfi_${p}`, () => wrapSeries(engine.mfi(p), targetIndex));
                }
                return wrapSeries(ind.mfi(cList, p), localLast);
            },
            adx: (p = 14) => {
                if (engine) {
                    const r = cached(`adx_${p}`, () => engine.adx(p));
                    return [wrapSeries(r.adx, targetIndex), wrapSeries(r.diPlus, targetIndex), wrapSeries(r.diMinus, targetIndex)];
                }
                const r = cached(`adx_${p}`, () => ind.adx(cList, p));
                return [wrapSeries(r.adx, localLast), wrapSeries(r.diPlus, localLast), wrapSeries(r.diMinus, localLast)];
            },
            dmi: (p = 14, _adxP = 14) => {
                if (engine) {
                    const r = cached(`adx_${p}`, () => engine.adx(p));
                    return [wrapSeries(r.diPlus, targetIndex), wrapSeries(r.diMinus, targetIndex), wrapSeries(r.adx, targetIndex)];
                }
                const r = cached(`adx_${p}`, () => ind.adx(cList, p));
                return [wrapSeries(r.diPlus, localLast), wrapSeries(r.diMinus, localLast), wrapSeries(r.adx, localLast)];
            },
            pivothigh: (src: number[], lb: number, rb: number) => wrapSeries(ind.pivothigh(src, lb, rb), localLast),
            pivotlow:  (src: number[], lb: number, rb: number) => wrapSeries(ind.pivotlow(src, lb, rb), localLast),
            highest:  (src: number[], p: number) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    return cached(`highest_${p}_${type}`, () => wrapSeries(engine.highest(p, type), targetIndex));
                }
                return wrapSeries(ind.highest(src, p), localLast);
            },
            lowest:   (src: number[], p: number) => {
                const type = getSeriesType(src);
                if (engine && type) {
                    return cached(`lowest_${p}_${type}`, () => wrapSeries(engine.lowest(p, type), targetIndex));
                }
                return wrapSeries(ind.lowest(src, p), localLast);
            },
            crossover:  (a: number[], b: number[] | number) => ind.crossover(a, b as any, targetIndex),
            crossunder: (a: number[], b: number[] | number) => ind.crossunder(a, b as any, targetIndex),
            change:  (src: number[], l = 1) => wrapSeries(ind.change(src, l), localLast),
            mom:     (src: number[], l: number) => wrapSeries(ind.mom(src, l), localLast),
            stdev:   (src: number[], p: number) => wrapSeries(ind.stdev(src, p), localLast),
            variance:(src: number[], p: number) => wrapSeries(ind.variance(src, p), localLast),
            correlation:(x: number[], y: number[], p: number) => wrapSeries(ind.correlation(x, y, p), localLast),
            linreg:  (src: number[], p: number, offset = 0) => wrapSeries(ind.linreg(src, p, offset), localLast),
            sum:     (src: number[], p: number) => wrapSeries(ind.sum(src, p), localLast),
            rising:  (src: number[], p: number) => ind.rising(src, p),
            falling: (src: number[], p: number) => ind.falling(src, p),
            barssince: (cond: boolean[]) => {
                let count = 0;
                for (let i = localLast; i >= 0; i--) {
                    if (cond[i]) return count;
                    count++;
                }
                return NaN;
            },
        };
    }

    const ta = buildTaNamespace(candles, execCtx?.indicators, true);

    // ── request namespace (Multi-Timeframe MTF support with strict lookahead guard) ───────────
    const request = {
        security(_sym: string, tf: string | number, exprFn: any) {
            const normTf = normalizeTimeframe(tf);
            const mtfContext = execCtx?.mtfCache?.get(normTf);
            const cursor = mtfContext?.cursor ?? execCtx?.cursors?.get(normTf);
            const htfSeries = mtfContext?.series ?? execCtx?.series?.get(normTf);
            const htfEngine = mtfContext?.indicators ?? execCtx?.timeframeIndicators?.get(normTf);
            const currentTs = execCtx ? execCtx.currentTimestamp : (candles[candles.length - 1]?.timestamp ?? Date.now());

            let htfLast: number;
            let effectiveCandles: Candle[];

            if (cursor && htfSeries) {
                htfLast = cursor.advanceTo(currentTs);
                if (htfLast < 0) htfLast = 0;
                effectiveCandles = [];
            } else {
                const rawHtfCandles = candleMap.get(normTf) || candles;
                const htfCandles = rawHtfCandles.filter(c => c.timestamp <= currentTs);
                effectiveCandles = htfCandles.length > 0 ? htfCandles : rawHtfCandles.slice(0, 1);
                htfLast = effectiveCandles.length - 1;
            }

            const htfOpen   = htfSeries ? wrapSeries(htfSeries.open, htfLast, 'open') : wrapSeries(effectiveCandles.map(c => c.open), htfLast, 'open');
            const htfHigh   = htfSeries ? wrapSeries(htfSeries.high, htfLast, 'high') : wrapSeries(effectiveCandles.map(c => c.high), htfLast, 'high');
            const htfLow    = htfSeries ? wrapSeries(htfSeries.low, htfLast, 'low') : wrapSeries(effectiveCandles.map(c => c.low), htfLast, 'low');
            const htfClose  = htfSeries ? wrapSeries(htfSeries.close, htfLast, 'close') : wrapSeries(effectiveCandles.map(c => c.close), htfLast, 'close');
            const htfVolume = htfSeries ? wrapSeries(htfSeries.volume, htfLast, 'volume') : wrapSeries(effectiveCandles.map(c => c.volume), htfLast, 'volume');
            const htfHL2    = htfSeries ? wrapSeries(htfSeries.hl2, htfLast) : wrapSeries(effectiveCandles.map(c => (c.high + c.low) / 2), htfLast);
            const htfHLC3   = htfSeries ? wrapSeries(htfSeries.hlc3, htfLast) : wrapSeries(effectiveCandles.map(c => (c.high + c.low + c.close) / 3), htfLast);
            const htfOHLC4  = htfSeries ? wrapSeries(htfSeries.ohlc4, htfLast) : wrapSeries(effectiveCandles.map(c => (c.open + c.high + c.low + c.close) / 4), htfLast);
            const htfTa     = buildTaNamespace(effectiveCandles, htfEngine, false, htfLast);

            if (typeof exprFn === 'function') {
                const res = exprFn(
                    htfClose, htfHigh, htfLow, htfOpen, htfVolume,
                    htfHL2, htfHLC3, htfOHLC4,
                    htfTa, math, htfLast
                );
                if (Array.isArray(res)) {
                    if (Array.isArray(res[0])) {
                        return res.map(arr => wrapSeries(arr, htfLast));
                    }
                    return res[htfLast];
                }
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
        const useCompiled = options.useCompiledScript ?? true;
        let compiled = options.compiledScript;
        if (useCompiled && !compiled) {
            compiled = defaultCompiler.compile(script);
        }

        if (compiled) {
            compiled.execute(
                strategy, ta, request, input, color, math, syminfo, timeframe,
                nz, na, fixnan,
                open, high, low, close, volume,
                hl2, hlc3, ohlc4,
                last, last
            );
        } else {
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
        }
    } catch (err: any) {
        console.error('[PineInterpreter] Error:', err.message?.slice(0, 200));
    }

    // ── Optional Confluence Score Calculation ─────────────────────
    //
    // IMPORTANT:
    // Pine strategy execution itself does NOT depend on this score.
    //
    // This is an optional BreakoutEx AI layer and is disabled by
    // default so that the Pine backtester tests the actual strategy.
    //
    // Enable explicitly with:
    //     calculateConfluenceScore: true
    // ----------------------------------------------------------------

    if (
        calculateConfluence &&
        (
            ctx.signal.action === 'buy' ||
            ctx.signal.action === 'sell'
        )
    ) {

        if (
            ctx.signal.score === undefined
        ) {

            let score = 50;

            const rsiArr =
                ind.rsi(
                    close,
                    14
                );

            const currentRsi =
                rsiArr[last] || 50;

            const ema20Arr =
                ind.ema(
                    close,
                    Math.min(
                        20,
                        Math.floor(
                            n / 2
                        )
                    )
                );

            const ema50Arr =
                ind.ema(
                    close,
                    Math.min(
                        50,
                        Math.floor(
                            n / 2
                        )
                    )
                );

            const currentEma20 =
                ema20Arr[last] ||
                close[last];

            const currentEma50 =
                ema50Arr[last] ||
                close[last];

            const currentPrice =
                close[last];

            // --------------------------------------------------------
            // RSI
            // --------------------------------------------------------

            if (
                ctx.signal.action === 'buy' &&
                currentRsi >= 45 &&
                currentRsi <= 70
            ) {

                score += 15;

            } else if (
                ctx.signal.action === 'sell' &&
                currentRsi <= 55 &&
                currentRsi >= 30
            ) {

                score += 15;
            }

            // --------------------------------------------------------
            // Trend
            // --------------------------------------------------------

            if (
                ctx.signal.action === 'buy' &&
                currentPrice > currentEma20 &&
                currentEma20 >= currentEma50
            ) {

                score += 20;

            } else if (
                ctx.signal.action === 'sell' &&
                currentPrice < currentEma20 &&
                currentEma20 <= currentEma50
            ) {

                score += 20;
            }

            // --------------------------------------------------------
            // Volume
            // --------------------------------------------------------

            const volSma =
                ind.sma(
                    volume,
                    Math.min(
                        20,
                        n
                    )
                );

            const currentVol =
                volume[last];

            const avgVol =
                volSma[last] ||
                currentVol;

            if (
                currentVol >
                avgVol * 1.1
            ) {

                score += 15;
            }

            ctx.signal.score =
                Math.min(
                    100,
                    Math.max(
                        0,
                        score
                    )
                );

            ctx.signal.source =
                'ai';
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

    // 4. Transform request.security calls with robust balanced parentheses
    s = transformSecurityCalls(s);

    // 5. Convert Pine series[N] offset access -> array[last - N]
    // Supports both identifier[N] and functionCall(...)[N]
    s = s.replace(/(\w+(?:\([^)]*\))?)\[(\d+)\]/g, (_, name, offset) => {
        const n = parseInt(offset);
        if (n === 0) return `${name}[last]`;
        return `${name}[last - ${n}]`;
    });

    // Strip Pine named argument labels e.g. "step = 0.1", "comment = 'x'", "stop = longStop", "limit = longTarget"
    s = s.replace(/([(,]\s*)(?:step|step_size|comment|stop|limit|loss|profit|qty|when|overlay|precision|scale|format|title|defval|minval|maxval|options|inline|group|tooltip|lookahead|gaps)\s*=\s*/g, '$1');

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

    // Add return statement to standalone expression lines inside function definitions
    s = s.replace(/(function\s+[a-zA-Z_]\w*\s*\([^)]*\)\s*\{[\s\S]*?)([ \t]+)([a-zA-Z_]\w*(?:\[[^\]]+\])?)\s*\n(\s*\})/g, '$1$2return $3;\n$4');

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

function transformSecurityCalls(src: string): string {
    let result = '';
    let idx = 0;
    const target = 'request.security';

    while (idx < src.length) {
        const secIdx = src.indexOf(target, idx);
        if (secIdx === -1) {
            result += src.slice(idx);
            break;
        }

        result += src.slice(idx, secIdx);
        const openParen = src.indexOf('(', secIdx);
        if (openParen === -1) {
            result += target;
            idx = secIdx + target.length;
            continue;
        }

        // Parse balanced parentheses
        let depth = 1;
        let i = openParen + 1;
        let insideStr: string | null = null;
        while (i < src.length && depth > 0) {
            const ch = src[i];
            if (insideStr) {
                if (ch === insideStr && src[i - 1] !== '\\') insideStr = null;
            } else {
                if (ch === '"' || ch === "'") insideStr = ch;
                else if (ch === '(') depth++;
                else if (ch === ')') depth--;
            }
            if (depth > 0) i++;
        }

        if (depth !== 0) {
            result += src.slice(secIdx, openParen + 1);
            idx = openParen + 1;
            continue;
        }

        const argsStr = src.slice(openParen + 1, i);
        const args: string[] = [];
        let cur = '';
        let d = 0;
        let sQuote: string | null = null;
        for (let j = 0; j < argsStr.length; j++) {
            const ch = argsStr[j];
            if (sQuote) {
                cur += ch;
                if (ch === sQuote && argsStr[j - 1] !== '\\') sQuote = null;
            } else {
                if (ch === '"' || ch === "'") {
                    sQuote = ch;
                    cur += ch;
                } else if (ch === '(' || ch === '[' || ch === '{') {
                    d++;
                    cur += ch;
                } else if (ch === ')' || ch === ']' || ch === '}') {
                    d--;
                    cur += ch;
                } else if (ch === ',' && d === 0) {
                    args.push(cur.trim());
                    cur = '';
                } else {
                    cur += ch;
                }
            }
        }
        if (cur.trim()) args.push(cur.trim());

        const sym = args[0] || 'syminfo.tickerid';
        const tf = args[1] || '"5m"';
        let expr = args[2] || 'close';

        if (expr.startsWith('lookahead') || expr.startsWith('gaps')) {
            expr = 'close';
        }

        result += `request.security(${sym}, ${tf}, (close, high, low, open, volume, hl2, hlc3, ohlc4, ta, math, last) => (${expr}))`;
        idx = i + 1;
    }

    return result;
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
            /^switch\s/.test(trimmed) ||
            /^[a-zA-Z_]\w*\s*\([^)]*\)\s*=>\s*$/.test(trimmed);

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
                } else if (/^[a-zA-Z_]\w*\s*\([^)]*\)\s*=>\s*$/.test(converted)) {
                    converted = converted.replace(/^([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*=>\s*$/, 'function $1($2) {');
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
