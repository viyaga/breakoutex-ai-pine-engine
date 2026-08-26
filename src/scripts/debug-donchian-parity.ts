import { Candle } from '../config/types';
import { STRATEGY_LIBRARY } from '../pine/strategy-library';
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

async function debugDonchianParity() {
    console.log(`================================================================================`);
    console.log(`🔬 CANDLE-BY-CANDLE DIAGNOSTIC: MTF DONCHIAN BREAKOUT 4H`);
    console.log(`================================================================================\n`);

    const symbol = 'ETHUSDT';
    console.log(`Fetching ${symbol} live klines (5m, 15m, 1h, 4h)...`);
    const candles5m = await fetchBinanceKlines(symbol, '5m', 1000);
    const candles15m = await fetchBinanceKlines(symbol, '15m', 800);
    const candles1h = await fetchBinanceKlines(symbol, '1h', 500);
    const candles4h = await fetchBinanceKlines(symbol, '4h', 300);

    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', candles5m);
    candleMap.set('15m', candles15m);
    candleMap.set('1h', candles1h);
    candleMap.set('4h', candles4h);

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

    const strat = STRATEGY_LIBRARY['mtf_donchian_breakout'];

    console.log(`Executing Mobile Runner on Donchian Breakout...`);
    const mobileRunner = new PineV6BacktestRunner();
    const mobileRes = await mobileRunner.execute(strat.pineScript, mobileCandles5m, {
        symbol: 'ETHUSDT',
        baseTimeframe: '5',
        initialCapital: 10000,
        leverage: 1,
        commissionPercent: 0.04,
        slippageTicks: 1,
        tickSize: 0.1,
        pyramiding: 1,
        htfCandlesMap,
    });

    console.log(`Mobile Trades Count: ${mobileRes.metrics.totalTrades}`);

    // Now let's trace every 5m candle from bar 50 to 1000
    console.log(`\nScanning 1,000 candles for first divergence between Backend and Mobile...`);
    let backendSignals = 0;
    let mobileSignals = 0;
    let firstDivergenceFound = false;

    for (let bar = 50; bar < candles5m.length; bar++) {
        const slice5m = candles5m.slice(0, bar + 1);
        const cutoff = candles5m[bar].timestamp;

        const sliceMap = new Map<string, Candle[]>();
        sliceMap.set('5m', slice5m);
        sliceMap.set('15m', candles15m.filter(c => c.timestamp <= cutoff));
        sliceMap.set('1h', candles1h.filter(c => c.timestamp <= cutoff));
        sliceMap.set('4h', candles4h.filter(c => c.timestamp <= cutoff));

        const bSig = evaluatePineScript(strat.pineScript, sliceMap, '5m');
        const bAction = bSig.action;

        if (bAction !== 'none') {
            backendSignals++;
            console.log(`[BACKEND SIGNAL] Bar #${bar} @ ${new Date(candles5m[bar].timestamp).toISOString()} -> Action: ${bAction.toUpperCase()}`);
            console.log(`   - 5M Bar: Open=${candles5m[bar].open}, High=${candles5m[bar].high}, Low=${candles5m[bar].low}, Close=${candles5m[bar].close}`);
            
            // Check what Mobile did on this bar
            const mTradeEntry = mobileRes.metrics.trades.find(t => t.entryBarIndex === bar);
            console.log(`   - Mobile Entry: ${mTradeEntry ? mTradeEntry.direction : 'NONE'}`);
        }
    }

    console.log(`\nSummary: Backend found ${backendSignals} entry signals, Mobile executed ${mobileRes.metrics.totalTrades} trades.`);
}

debugDonchianParity().catch(console.error);
