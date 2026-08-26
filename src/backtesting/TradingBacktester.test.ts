// ================================================================
// BreakoutEx AI — TradingBacktester Public API Tests
// ================================================================

import { Candle } from '../config/types';
import { TradingBacktester } from './TradingBacktester';
import { STRATEGY_LIBRARY } from '../pine/strategy-library';

function generateCandles(
    count: number,
    intervalMinutes: number,
    baseTimestamp: number,
    basePrice = 50000
): Candle[] {
    const candles: Candle[] = [];
    let price = basePrice;
    const intervalMs = intervalMinutes * 60 * 1000;

    for (let i = 0; i < count; i++) {
        const change = (Math.sin(i / 8) + Math.cos(i / 5)) * 30;
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + 15;
        const low = Math.min(open, close) - 15;
        const volume = 1000 + (i % 20) * 50;
        candles.push({
            timestamp: baseTimestamp + i * intervalMs,
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

export function runTradingBacktesterTests(): void {
    console.log('Running TradingBacktester Unified API Tests...\n');

    const baseTimestamp = 1700000000000 - (1700000000000 % 3600000);
    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', generateCandles(1000, 5, baseTimestamp));
    candleMap.set('15m', generateCandles(600, 15, baseTimestamp));
    candleMap.set('1h', generateCandles(300, 60, baseTimestamp));
    candleMap.set('4h', generateCandles(250, 240, baseTimestamp));

    // ------------------------------------------------------------
    // Test 1: Single Strategy via Strategy Definition
    // ------------------------------------------------------------
    console.log('1. Testing TradingBacktester.run with Strategy Definition...');
    const result1 = TradingBacktester.run({
        strategy: STRATEGY_LIBRARY.mtf_trend_continuation,
        candleMap,
        options: {
            windowBars: 500,
            warmupBars: 100,
        },
    });

    if (!result1 || typeof result1.netProfit !== 'number') {
        throw new Error('Test 1 Failed: Expected valid BacktestResult');
    }
    console.log(`✅ Test 1 Passed: Strategy "${result1.strategyName}" executed (Trades: ${result1.totalTrades}, Return: ${result1.totalReturnPercent.toFixed(2)}%)`);

    // ------------------------------------------------------------
    // Test 2: Single Strategy via String ID
    // ------------------------------------------------------------
    console.log('\n2. Testing TradingBacktester.run with Strategy ID String...');
    const result2 = TradingBacktester.run({
        strategy: 'mtf_supertrend_vwap',
        candleMap,
        options: {
            windowBars: 500,
            warmupBars: 100,
        },
    });

    if (result2.strategyId !== 'mtf_supertrend_vwap') {
        throw new Error(`Test 2 Failed: Expected strategyId "mtf_supertrend_vwap", got "${result2.strategyId}"`);
    }
    console.log(`✅ Test 2 Passed: Strategy ID resolved and executed (Trades: ${result2.totalTrades}, WinRate: ${result2.winRate}%)`);

    // ------------------------------------------------------------
    // Test 3: Raw Pine Script Execution via runPine()
    // ------------------------------------------------------------
    console.log('\n3. Testing TradingBacktester.runPine with Raw Pine Script...');
    const rawPine = `
        //@version=5
        strategy("Simple EMA Cross", overlay=true)
        fastEma = ta.ema(close, 9)
        slowEma = ta.ema(close, 21)
        if ta.crossover(fastEma, slowEma)
            strategy.entry("Long", strategy.long)
        if ta.crossunder(fastEma, slowEma)
            strategy.close("Long")
    `;

    const result3 = TradingBacktester.runPine({
        pineScript: rawPine,
        strategyName: 'Custom Simple EMA Cross',
        candleMap,
        options: {
            windowBars: 500,
            warmupBars: 100,
        },
    });

    if (!result3 || result3.strategyName !== 'Custom Simple EMA Cross') {
        throw new Error('Test 3 Failed: Raw Pine script backtest failed');
    }
    console.log(`✅ Test 3 Passed: Raw Pine Script executed (Trades: ${result3.totalTrades}, Net Profit: $${result3.netProfit})`);

    // ------------------------------------------------------------
    // Test 4: Batch Backtest via runMany()
    // ------------------------------------------------------------
    console.log('\n4. Testing TradingBacktester.runMany with Array of Strategy IDs...');
    const results4 = TradingBacktester.runMany({
        strategies: [
            'mtf_trend_continuation',
            'mtf_supertrend_vwap',
            'mtf_failed_breakout',
        ],
        candleMap,
        options: {
            windowBars: 500,
            warmupBars: 100,
        },
    });

    if (results4.length !== 3) {
        throw new Error(`Test 4 Failed: Expected 3 results, got ${results4.length}`);
    }
    console.log(`✅ Test 4 Passed: Batch execution returned ${results4.length} strategy results`);

    // ------------------------------------------------------------
    // Test 5: Benchmark Execution via benchmark()
    // ------------------------------------------------------------
    console.log('\n5. Testing TradingBacktester.benchmark...');
    const report = TradingBacktester.benchmark({
        strategies: [
            'mtf_trend_continuation',
            'mtf_supertrend_vwap',
        ],
        candleMap,
        options: {
            windowBars: 500,
            warmupBars: 100,
        },
    });

    if (report.totalStrategies !== 2 || report.strategyBreakdown.length !== 2) {
        throw new Error('Test 5 Failed: Expected 2 strategy breakdown entries');
    }
    console.log(`✅ Test 5 Passed: Benchmark report generated (${report.overallBarsPerSecond.toLocaleString()} bars/sec throughput, ${report.totalTimeMs}ms)`);

    console.log('\n🎉 All TradingBacktester Unified Public API Tests Passed Successfully!');
}

if (typeof require !== 'undefined' && require.main === module) {
    runTradingBacktesterTests();
}
