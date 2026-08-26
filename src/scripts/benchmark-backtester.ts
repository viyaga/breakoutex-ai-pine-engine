import { Candle } from '../config/types';
import { getAllStrategies } from '../pine/strategy-library';
import { Backtester } from '../backtesting/Backtester';
import { PerformanceTimer } from '../backtesting/PerformanceTimer';

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

export function runBenchmark(): void {
    console.log('================================================================');
    console.log('⚡ BREAKOUTEX AI — BACKTESTER PERFORMANCE BENCHMARK');
    console.log('================================================================\n');

    const candleMap = new Map<string, Candle[]>();
    const barCount = 10_000;
    console.log(`Generating test candle datasets (${barCount} 5m bars, MTF up to 1d)...`);
    candleMap.set('5m', generateCandles(barCount, 50000));
    candleMap.set('15m', generateCandles(3000, 50000));
    candleMap.set('1h', generateCandles(1000, 50000));
    candleMap.set('4h', generateCandles(500, 50000));
    candleMap.set('1d', generateCandles(300, 50000));

    const strategies = getAllStrategies();
    console.log(`Evaluating ${strategies.length} production MTF strategies over ${barCount} bars...\n`);

    const memBefore = process.memoryUsage().heapUsed / 1024 / 1024;
    const batchTimer = new PerformanceTimer();

    const results = Backtester.runMany(
        strategies,
        candleMap,
        {
            baseTimeframe: '5m',
            windowBars: barCount,
            warmupBars: 2_000,
            performance: {
                enabled: true,
            },
            diagnostics: {
                collectSignals: false,
            },
            validateResult: true,
            strict: false,
        }
    );

    const totalBatchMs = batchTimer.total();
    const memAfter = process.memoryUsage().heapUsed / 1024 / 1024;
    const memDelta = memAfter - memBefore;

    console.log('\n--- Individual Strategy Performance ---');
    let totalBars = 0;

    for (const r of results) {
        const p = r.performance;
        totalBars += r.diagnostics.testBars;
        const timeStr = p ? `${p.totalMs.toFixed(2)}ms` : 'N/A';
        const speedStr = p && p.barsPerSecond ? `${p.barsPerSecond.toLocaleString()} bars/s` : 'N/A';
        const simStr = p ? `(prep: ${p.dataPreparationMs.toFixed(1)}ms, sim: ${p.simulationMs.toFixed(1)}ms, val: ${p.validationMs.toFixed(1)}ms)` : '';

        console.log(
            `  • ${r.strategyId.padEnd(35)} | Time: ${timeStr.padEnd(10)} | Speed: ${speedStr.padEnd(16)} | Trades: ${r.totalTrades} | Return: ${r.netPnlPercent.toFixed(2)}% ${simStr}`
        );
    }

    const avgTimeMs = totalBatchMs / (results.length || 1);
    const overallBarsPerSec = totalBatchMs > 0 ? Math.round((totalBars / (totalBatchMs / 1000))) : 0;

    console.log('\n================================================================');
    console.log(`📊 BENCHMARK SUMMARY:`);
    console.log(`  • Total Strategies Evaluated: ${results.length}`);
    console.log(`  • Total Bars Processed:       ${totalBars.toLocaleString()} bars`);
    console.log(`  • Total Batch Execution Time: ${totalBatchMs.toFixed(2)}ms (${(totalBatchMs / 1000).toFixed(2)}s)`);
    console.log(`  • Average Time Per Strategy:  ${avgTimeMs.toFixed(2)}ms`);
    console.log(`  • Overall Throughput:         ${overallBarsPerSec.toLocaleString()} bars/sec`);
    console.log(`  • Heap Memory Delta:          ${memDelta.toFixed(2)} MB (Current Heap: ${memAfter.toFixed(2)} MB)`);
    console.log('================================================================\n');
}

if (typeof require !== 'undefined' && require.main === module) {
    runBenchmark();
}
