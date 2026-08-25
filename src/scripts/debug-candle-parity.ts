// ================================================================
// BreakoutEx AI — Candle-by-Candle Parity Debugger
// Compares indicator calculations, MTF lookups, boolean conditions,
// and order emissions candle-by-candle between Backend and Mobile Engines.
// ================================================================

import { Candle } from '../config/types';
import { STRATEGY_LIBRARY } from '../pine/strategy-library';
import { backtestStrategy } from '../pine/backtester';
import { evaluatePineScript } from '../pine/interpreter';
import { PineV6BacktestRunner } from '../../../breakoutex-ai-mobile/src/pine-engine/runner';
import { PineCandle } from '../../../breakoutex-ai-mobile/src/pine-engine/types';

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

    const candles5m = await fetchBinanceKlines('ETHUSDT', '5m', 150);
    const candles15m = await fetchBinanceKlines('ETHUSDT', '15m', 100);

    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', candles5m);
    candleMap.set('15m', candles15m);

    // Strategy under test
    const strat = STRATEGY_LIBRARY['mtf_failed_breakout'];

    console.log(`▶ Running Bar-by-Bar Step Comparison for MTF Failed Breakout (Trap Hunter):`);
    console.log(`Bar | Time (UTC)       | Close   | Backend Sig | Mobile Sig  | Mobile Trades`);
    console.log(`--------------------------------------------------------------------------------------`);

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

    let backendSignalsCount = 0;
    for (let bar = 25; bar < candles5m.length; bar++) {
        const slice5m = candles5m.slice(0, bar + 1);
        const sliceMap = new Map<string, Candle[]>();
        sliceMap.set('5m', slice5m);
        const cutoff = candles5m[bar].timestamp;
        sliceMap.set('15m', candles15m.filter(c => c.timestamp <= cutoff));

        const bSig = evaluatePineScript(strat.pineScript, sliceMap, '5m');
        const bAction = bSig.action.toUpperCase();

        const mTradeEntry = mobileResult.metrics.trades.find(t => t.entryBarIndex === bar);
        const mTradeExit = mobileResult.metrics.trades.find(t => t.exitBarIndex === bar);
        const mAction = mTradeEntry ? `ENTRY_${mTradeEntry.direction.toUpperCase()}` : mTradeExit ? `EXIT_${mTradeExit.exitReason.toUpperCase()}` : 'NONE';

        if (bAction !== 'NONE' || mAction !== 'NONE') {
            if (bAction !== 'NONE') backendSignalsCount++;
            console.log(
                `${String(bar).padStart(3)} | ${new Date(candles5m[bar].timestamp).toISOString().slice(11, 19)} | ${candles5m[bar].close.toFixed(2).padStart(7)} | ${bAction.padEnd(11)} | ${mAction.padEnd(11)} | ${mTradeExit ? 'CLOSED' : 'ACTIVE'}`
            );
        }
    }

    console.log(`--------------------------------------------------------------------------------------`);
    console.log(`Summary: Backend Detected ${backendSignalsCount} signals | Mobile Completed ${mobileResult.metrics.totalTrades} trades`);
}

debugParity().catch(console.error);
