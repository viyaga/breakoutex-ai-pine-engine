import { STRATEGY_LIBRARY, getAllStrategies } from '../pine/strategy-library';
import { evaluatePineScript } from '../pine/interpreter';
import { backtestStrategy } from '../pine/backtester';
import { Candle } from '../config/types';

function generateCandles(count: number, basePrice: number): Candle[] {
    const candles: Candle[] = [];
    let price = basePrice;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        const change = (Math.sin(i / 5) + Math.cos(i / 3)) * (price * 0.002);
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + price * 0.001;
        const low = Math.min(open, close) - price * 0.001;
        const volume = 1000 + (i % 10) * 100;
        price = close;
        candles.push({
            timestamp: now - (count - i) * 300000,
            open,
            high,
            low,
            close,
            volume,
        });
    }
    return candles;
}

const candleMap = new Map<string, Candle[]>();
candleMap.set('5m', generateCandles(200, 60000));
candleMap.set('15m', generateCandles(100, 60000));
candleMap.set('1h', generateCandles(60, 60000));
candleMap.set('4h', generateCandles(40, 60000));

console.log(`\nTesting All 12 Production MTF Strategy Families:\n`);
const all = getAllStrategies();

for (let i = 0; i < all.length; i++) {
    const s = all[i];
    const num = String(i + 1).padStart(2, '0');
    try {
        const sig = evaluatePineScript(s.pineScript, candleMap, '5m');
        const bt = backtestStrategy(s, candleMap, '5m', 100);
        console.log(`[${num}/12] ✓ ${s.id.padEnd(35)} | Action: ${sig.action.padEnd(5)} | BT Trades: ${bt.totalTrades}, WR: ${bt.winRate}%`);
    } catch (e: any) {
        console.error(`[${num}/12] ✗ ${s.id}: FAILED -> ${e.message}`);
        process.exit(1);
    }
}

console.log(`\nAll 12 MTF Strategy Families Passed Interpreter & Backtester Tests!`);
