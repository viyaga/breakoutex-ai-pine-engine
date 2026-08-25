import { Candle } from '../config/types';
import { STRATEGY_LIBRARY } from '../pine/strategy-library';
import { evaluatePineScript } from '../pine/interpreter';
import { highest, rsi, sma } from '../pine/indicators';

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

async function debugSingleBar(barIndex = 81) {
    const candles5m = await fetchBinanceKlines('ETHUSDT', '5m', 150);
    const candles15m = await fetchBinanceKlines('ETHUSDT', '15m', 100);

    const slice5m = candles5m.slice(0, barIndex + 1);
    const cutoff = candles5m[barIndex].timestamp;
    const slice15m = candles15m.filter(c => c.timestamp <= cutoff);

    const bar = candles5m[barIndex];
    console.log(`Bar ${barIndex} OHLC:`, bar);

    // 15m highest of high for past 20 bars
    const htfHighs = slice15m.map(c => c.high);
    const highest20 = highest(htfHighs, 20);
    const rangeHigh_1 = highest20[highest20.length - 2]; // 1 bar ago on 15m
    console.log(`15m RangeHigh[1]:`, rangeHigh_1);

    // 5m conditions
    const closes = slice5m.map(c => c.close);
    const rsiArr = rsi(closes, 14);
    const rsiVal = rsiArr[rsiArr.length - 1];
    const vols = slice5m.map(c => c.volume);
    const volAvgArr = sma(vols, 20);
    const volAvg = volAvgArr[volAvgArr.length - 1];

    const bullTrap = bar.high > rangeHigh_1 && bar.close < rangeHigh_1 && bar.close < bar.open;
    const shortCond = bullTrap && rsiVal < 60 && bar.volume > volAvg;

    console.log(`Conditions:`);
    console.log(`  - high > rangeHigh: ${bar.high} > ${rangeHigh_1} => ${bar.high > rangeHigh_1}`);
    console.log(`  - close < rangeHigh: ${bar.close} < ${rangeHigh_1} => ${bar.close < rangeHigh_1}`);
    console.log(`  - close < open: ${bar.close} < ${bar.open} => ${bar.close < bar.open}`);
    console.log(`  - bullTrap: ${bullTrap}`);
    console.log(`  - rsi < 60: ${rsiVal?.toFixed(2)} < 60 => ${rsiVal < 60}`);
    console.log(`  - volume > volAvg: ${bar.volume} > ${volAvg?.toFixed(2)} => ${bar.volume > volAvg}`);
    console.log(`  - SHORT CONDITION: ${shortCond}`);
}

debugSingleBar(81).catch(console.error);
