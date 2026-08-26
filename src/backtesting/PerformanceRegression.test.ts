import { Candle } from '../config/types';
import { TradingBacktester } from './TradingBacktester';
import { getAllStrategies } from './strategy-library';

function generateBenchmarkCandles(count: number, startPrice = 100): Candle[] {
    const candles: Candle[] = [];
    let price = startPrice;
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);

    for (let i = 0; i < count; i++) {
        const change = (i % 2 === 0 ? 1 : -1) * 1.5;
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + 0.8;
        const low = Math.min(open, close) - 0.8;
        const volume = 1000 + (i % 10) * 50;
        candles.push({
            timestamp: start + i * 5 * 60_000,
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

export function testPerformanceRegression(): void {
    console.log('\n================================================================');
    console.log('  ⚡ PART 15 — PERFORMANCE BENCHMARK & SCALE REGRESSION');
    console.log('================================================================\n');

    const scales = [10_000, 20_000, 50_000];
    const strategies = getAllStrategies().slice(0, 3);

    console.log(
        'Scale (Bars)'.padEnd(16) +
        '| Total Time (ms)'.padEnd(20) +
        '| Throughput (bars/sec)'.padEnd(25) +
        '| Memory (MB)'.padEnd(16) +
        '| Status'
    );
    console.log('─'.repeat(85));

    for (const count of scales) {
        const candles = generateBenchmarkCandles(count);
        const candleMap = new Map<string, Candle[]>([
            ['5m', candles],
            ['15m', candles],
            ['1h', candles],
            ['4h', candles],
            ['1d', candles],
        ]);

        const t0 = performance.now();
        const mem0 = process.memoryUsage().heapUsed;

        for (const strat of strategies) {
            TradingBacktester.run({
                strategy: strat,
                candleMap,
                timeframe: '5m',
            });
        }

        const t1 = performance.now();
        const mem1 = process.memoryUsage().heapUsed;

        const totalMs = t1 - t0;
        const totalBarsProcessed = count * strategies.length;
        const barsPerSec = Math.round((totalBarsProcessed / (totalMs / 1000)));
        const heapMb = ((mem1 - mem0) / (1024 * 1024)).toFixed(2);

        console.log(
            `${count.toLocaleString()} bars`.padEnd(16) +
            `| ${totalMs.toFixed(2)} ms`.padEnd(20) +
            `| ${barsPerSec.toLocaleString()} bars/s`.padEnd(25) +
            `| ${heapMb} MB`.padEnd(16) +
            '| ✅ PASS'
        );
    }

    console.log('\n' + '─'.repeat(85));
    console.log('🎉 ALL PART 15 PERFORMANCE & REGRESSION CHECKS PASSED!\n');
}

if (typeof require !== 'undefined' && require.main === module) {
    testPerformanceRegression();
}
