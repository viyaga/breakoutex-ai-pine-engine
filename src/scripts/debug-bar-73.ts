import { Candle } from '../config/types';
import { STRATEGY_LIBRARY } from '../pine/strategy-library';
import { PineV6BacktestRunner } from '../../../breakoutex-ai-mobile/src/pine-engine/runner';
import { PineCandle } from '../../../breakoutex-ai-mobile/src/pine-engine/types';
import { PineLexer } from '../../../breakoutex-ai-mobile/src/pine-engine/lexer';
import { PineParser } from '../../../breakoutex-ai-mobile/src/pine-engine/parser';
import { PineTALib } from '../../../breakoutex-ai-mobile/src/pine-engine/ta';
import { FloatSeriesBuffer } from '../../../breakoutex-ai-mobile/src/pine-engine/buffers';
import { MTFSecurityEngine } from '../../../breakoutex-ai-mobile/src/pine-engine/mtf/security';
import { highest, lowest, sma, ema, rsi } from '../pine/indicators';

async function fetchBinanceKlines(symbol: string, interval: string, limit = 500): Promise<Candle[]> {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = (await resp.json()) as any[][];
    return raw.map(d => ({
        timestamp: Number(d[0]),
        open: Number(d[1]),
        high: Number(d[2]),
        low: Number(d[3]),
        close: Number(d[4]),
        volume: Number(d[5]),
    }));
}

async function debugBar73() {
    console.log(`================================================================================`);
    console.log(`🔬 DEEP-DIVE AUDIT AT FIRST DIVERGENCE: BAR #73 (2026-08-22 12:05:00 UTC)`);
    console.log(`================================================================================\n`);

    const candles5m = await fetchBinanceKlines('ETHUSDT', '5m', 1000);
    const candles15m = await fetchBinanceKlines('ETHUSDT', '15m', 800);
    const candles1h = await fetchBinanceKlines('ETHUSDT', '1h', 500);
    const candles4h = await fetchBinanceKlines('ETHUSDT', '4h', 300);

    const barIdx = 73;
    const bar = candles5m[barIdx];
    const prevBar = candles5m[barIdx - 1];
    const cutoff = bar.timestamp;

    console.log(`Bar #73 Timestamp: ${new Date(bar.timestamp).toISOString()} (${bar.timestamp})`);
    console.log(`Bar #73 OHLCV: Open=${bar.open}, High=${bar.high}, Low=${bar.low}, Close=${bar.close}, Vol=${bar.volume}`);
    console.log(`Prev Bar OHLCV: Open=${prevBar.open}, High=${prevBar.high}, Low=${prevBar.low}, Close=${prevBar.close}, Vol=${prevBar.volume}\n`);

    // ─────────────────────────────────────────────────────────────
    // 1. BACKEND CALCULATION
    // ─────────────────────────────────────────────────────────────
    console.log(`--- [1. BACKEND ENGINE CALCULATIONS] ---`);
    const slice4h = candles4h.filter(c => c.timestamp <= cutoff);
    const slice1h = candles1h.filter(c => c.timestamp <= cutoff);
    const slice5m = candles5m.slice(0, barIdx + 1);

    const closes4h = slice4h.map(c => c.close);
    const ema50_4h_arr = ema(closes4h, 50);
    const ema200_4h_arr = ema(closes4h, 200);
    // [1] means 1 bar ago on 4h
    const b_ema50_4h = ema50_4h_arr[ema50_4h_arr.length - 2];
    const b_ema200_4h = ema200_4h_arr[ema200_4h_arr.length - 2];
    const b_bull4h = b_ema50_4h > b_ema200_4h;
    const b_bear4h = b_ema50_4h < b_ema200_4h;

    console.log(`4H Backend:`);
    console.log(`  - 4H Bars count: ${slice4h.length}`);
    console.log(`  - Last closed 4H Bar: ${new Date(slice4h[slice4h.length - 2].timestamp).toISOString()}`);
    console.log(`  - ema50_4h[1]: ${b_ema50_4h?.toFixed(2)}`);
    console.log(`  - ema200_4h[1]: ${b_ema200_4h?.toFixed(2)}`);
    console.log(`  - bull4h: ${b_bull4h}, bear4h: ${b_bear4h}`);

    const closes1h = slice1h.map(c => c.close);
    const ema50_1h_arr = ema(closes1h, 50);
    const ema200_1h_arr = ema(closes1h, 200);
    const b_close1h = closes1h[closes1h.length - 2];
    const b_ema50_1h = ema50_1h_arr[ema50_1h_arr.length - 2];
    const b_ema200_1h = ema200_1h_arr[ema200_1h_arr.length - 2];
    const b_bull1h = b_close1h > b_ema50_1h && b_ema50_1h > b_ema200_1h;

    console.log(`1H Backend:`);
    console.log(`  - close1h[1]: ${b_close1h}`);
    console.log(`  - ema50_1h[1]: ${b_ema50_1h?.toFixed(2)}`);
    console.log(`  - ema200_1h[1]: ${b_ema200_1h?.toFixed(2)}`);
    console.log(`  - bull1h: ${b_bull1h}`);

    const highs5m = slice5m.map(c => c.high);
    const highest20 = highest(highs5m, 20);
    const b_upper = highest20[highest20.length - 2]; // upper = ta.highest(high, 20)[1]
    const b_crossover = prevBar.close <= b_upper && bar.close > b_upper;

    const vols5m = slice5m.map(c => c.volume);
    const volSma = sma(vols5m, 20);
    const b_volAvg = volSma[volSma.length - 1];
    const b_volConfirmed = bar.volume > b_volAvg * 1.20;

    console.log(`5M Backend:`);
    console.log(`  - upper (highest(20)[1]): ${b_upper}`);
    console.log(`  - crossover(close, upper): prevClose(${prevBar.close}) <= ${b_upper} && close(${bar.close}) > ${b_upper} => ${b_crossover}`);
    console.log(`  - volAvg: ${b_volAvg?.toFixed(2)}, vol: ${bar.volume} > ${b_volAvg * 1.2} => ${b_volConfirmed}`);

    // ─────────────────────────────────────────────────────────────
    // 2. MOBILE CALCULATION VIA AST RUNNER
    // ─────────────────────────────────────────────────────────────
    console.log(`\n--- [2. MOBILE APP ENGINE CALCULATIONS] ---`);
    const strat = STRATEGY_LIBRARY['mtf_donchian_breakout'];
    const mobileCandles5m: PineCandle[] = candles5m.map(c => ({
        time: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));

    const htfCandlesMap: Record<string, PineCandle[]> = {
        '15': candles15m.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        '15m': candles15m.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        '60': candles1h.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        '1h': candles1h.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        '240': candles4h.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        '4h': candles4h.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
    };

    const mobileRunner = new PineV6BacktestRunner();
    
    // Let's manually inspect how mobile runner precomputes MTF
    const lexer = new PineLexer(strat.pineScript);
    const tokens = lexer.tokenize();
    const parser = new PineParser(tokens);
    const ast = parser.parse();

    // Call internal precomputeMTFRequests
    const mtfBindings = (mobileRunner as any).precomputeMTFRequests(ast, mobileCandles5m, new Map(), htfCandlesMap);
    console.log(`Mobile MTF Keys generated:`, Array.from(mtfBindings.keys()));

    for (const [key, binding] of mtfBindings.entries()) {
        const b = binding as any;
        const valAt73 = b.buffers[0].data[barIdx];
        console.log(`  - Key: ${key} -> Value at Bar #73 = ${valAt73}`);
    }
}

debugBar73().catch(console.error);
