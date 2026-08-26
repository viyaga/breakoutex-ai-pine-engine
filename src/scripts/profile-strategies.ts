import { Candle } from '../config/types';
import { getAllStrategies } from '../pine/strategy-library';
import { Backtester } from '../backtesting/Backtester';

function generateCandles(count: number, basePrice = 50000): Candle[] {
    const candles: Candle[] = [];
    let price = basePrice;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        const change = (Math.sin(i / 10) + Math.cos(i / 7) + (Math.random() - 0.5)) * 40;
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + Math.random() * 25;
        const low = Math.min(open, close) - Math.random() * 25;
        const volume = 1000 + Math.random() * 500;
        candles.push({
            timestamp: now - (count - i) * 300000,
            open,
            high,
            low,
            close,
            volume,
        });
        price = close;
    }
    return candles;
}

const candleMap = new Map<string, Candle[]>();
candleMap.set('5m', generateCandles(1000, 50000));
candleMap.set('15m', generateCandles(1000, 50000));
candleMap.set('1h', generateCandles(500, 50000));
candleMap.set('4h', generateCandles(300, 50000));
candleMap.set('1d', generateCandles(300, 50000));

const strategies = getAllStrategies();
console.log('Testing each strategy individually for 1,000 bars:');

for (const s of strategies) {
    const start = Date.now();
    const result = Backtester.run({
        strategy: s,
        candleMap,
        options: {
            baseTimeframe: '5m',
            windowBars: 1000,
            warmupBars: 200,
            performance: {
                enabled: true,
                usePrecomputedIndicators: true,
                useCompiledScript: true,
            },
        },
    });
    const elapsed = Date.now() - start;
    console.log(`- ${s.id.padEnd(35)}: ${elapsed}ms (trades: ${result.totalTrades})`);
}
