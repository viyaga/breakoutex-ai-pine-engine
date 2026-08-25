// ================================================================
// BreakoutEx AI — Candle-by-Candle Parity Debugger
// Compares indicator calculations, MTF lookups, boolean conditions,
// and order emissions candle-by-candle between Backend and Mobile Engines.
// ================================================================

import { Candle } from '../config/types';
import { STRATEGY_LIBRARY } from '../pine/strategy-library';
import { backtestStrategy } from '../pine/backtester';
import { executePineScript } from '../pine/interpreter';
import { PineV6BacktestRunner } from '../../../breakoutex-ai-mobile/src/pine-engine/runner';
import { PineCandle } from '../../../breakoutex-ai-mobile/src/pine-engine/types';
import { PineTALib } from '../../../breakoutex-ai-mobile/src/pine-engine/ta';
import { PineTALib as BackendTALib } from '../pine/indicators';

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

async function debugParity() {
    console.log(`================================================================================`);
    console.log(`🔬 CANDLE-BY-CANDLE INDICATOR & MTF PARITY AUDIT`);
    console.log(`================================================================================\n`);

    const candles5m = await fetchBinanceKlines('ETHUSDT', '5m', 300);
    const candles15m = await fetchBinanceKlines('ETHUSDT', '15m', 200);

    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', candles5m);
    candleMap.set('15m', candles15m);

    // 1. Check Technical Indicator Math Parity
    console.log(`▶ 1. Baseline Technical Indicator Math Parity (5m closes, 300 bars):`);
    const closes = candles5m.map(c => c.close);
    const highs = candles5m.map(c => c.high);
    const lows = candles5m.map(c => c.low);
    const volumes = candles5m.map(c => c.volume);

    // RSI
    const rsiBackend = BackendTALib.rsi(closes, 14);
    const rsiMobile = PineTALib.rsi(closes, 14);

    let rsiMaxDiff = 0;
    for (let i = 14; i < closes.length; i++) {
        const diff = Math.abs(rsiBackend[i] - rsiMobile[i]);
        if (diff > rsiMaxDiff) rsiMaxDiff = diff;
    }
    console.log(`  - RSI(14) Max Difference across 300 bars: ${rsiMaxDiff.toExponential(4)} [${rsiMaxDiff < 1e-6 ? 'PASS ✔' : 'FAIL ❌'}]`);

    // SMA
    const smaBackend = BackendTALib.sma(closes, 20);
    const smaMobile = PineTALib.sma(closes, 20);
    let smaMaxDiff = 0;
    for (let i = 20; i < closes.length; i++) {
        const diff = Math.abs(smaBackend[i] - smaMobile[i]);
        if (diff > smaMaxDiff) smaMaxDiff = diff;
    }
    console.log(`  - SMA(20) Max Difference across 300 bars: ${smaMaxDiff.toExponential(4)} [${smaMaxDiff < 1e-6 ? 'PASS ✔' : 'FAIL ❌'}]`);

    // EMA
    const emaBackend = BackendTALib.ema(closes, 20);
    const emaMobile = PineTALib.ema(closes, 20);
    let emaMaxDiff = 0;
    for (let i = 20; i < closes.length; i++) {
        const diff = Math.abs(emaBackend[i] - emaMobile[i]);
        if (diff > emaMaxDiff) emaMaxDiff = diff;
    }
    console.log(`  - EMA(20) Max Difference across 300 bars: ${emaMaxDiff.toExponential(4)} [${emaMaxDiff < 1e-6 ? 'PASS ✔' : 'FAIL ❌'}]`);

    // ATR
    const atrBackend = BackendTALib.atr(highs, lows, closes, 14);
    const atrMobile = PineTALib.atr(highs, lows, closes, 14);
    let atrMaxDiff = 0;
    for (let i = 14; i < closes.length; i++) {
        const diff = Math.abs(atrBackend[i] - atrMobile[i]);
        if (diff > atrMaxDiff) atrMaxDiff = diff;
    }
    console.log(`  - ATR(14) Max Difference across 300 bars: ${atrMaxDiff.toExponential(4)} [${atrMaxDiff < 1e-6 ? 'PASS ✔' : 'FAIL ❌'}]`);

    // 2. MTF & Strategy Interpreter Divergence Analysis
    console.log(`\n▶ 2. MTF Failed Breakout (Trap Hunter) Evaluation Step-by-Step:`);
    const strat = STRATEGY_LIBRARY['mtf_failed_breakout'];

    // Backend Execution
    const backendResult = executePineScript(strat.pineScript, candleMap, '5m', candles5m.length);
    console.log(`  Backend Engine Total Signals: Longs=${backendResult.signals.filter(s => s.type === 'long').length}, Shorts=${backendResult.signals.filter(s => s.type === 'short').length}`);

    // Mobile Execution
    const mobileCandles: PineCandle[] = candles5m.map(c => ({
        time: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));
    const mobileRunner = new PineV6BacktestRunner();
    const mobileResult = await mobileRunner.execute(strat.pineScript, mobileCandles, {
        symbol: 'ETHUSDT',
        baseTimeframe: '5',
        initialCapital: 10000,
        leverage: 1,
        commissionPercent: 0.04,
        slippageTicks: 1,
        tickSize: 0.1,
        pyramiding: 1,
    });
    console.log(`  Mobile Engine Total Trades: ${mobileResult.metrics.totalTrades}`);

    // Compare bar-by-bar
    console.log(`\n▶ 3. Detailed Bar-by-Bar Signal Comparison for first 50 bars:`);
    console.log(`Bar | Time (UTC)       | Close   | Backend Sig | Mobile Trades Active`);
    console.log(`------------------------------------------------------------------`);
    for (let bar = 0; bar < Math.min(50, candles5m.length); bar++) {
        const t = candles5m[bar];
        const bSig = backendResult.signals.find(s => s.candleIndex === bar);
        const mTrade = mobileResult.metrics.trades.find(tr => tr.entryBarIndex === bar);

        if (bSig || mTrade) {
            console.log(
                `${String(bar).padStart(3)} | ${new Date(t.timestamp).toISOString().slice(11, 19)} | ${t.close.toFixed(2)} | ${bSig ? bSig.type.toUpperCase() : 'NONE       '} | ${mTrade ? mTrade.direction.toUpperCase() : 'NONE'}`
            );
        }
    }
}

debugParity().catch(console.error);
