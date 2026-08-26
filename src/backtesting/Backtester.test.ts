import { Candle } from '../config/types';
import { PineStrategyDefinition } from '../pine/strategy-library';
import { Backtester } from './Backtester';

function generateBaseCandles(count: number, basePrice = 100): Candle[] {
    const candles: Candle[] = [];
    for (let i = 0; i < count; i++) {
        candles.push({
            timestamp: (i + 1) * 60000,
            open: basePrice,
            high: basePrice + 1,
            low: basePrice - 1,
            close: basePrice,
            volume: 1000,
        });
    }
    return candles;
}

function createTestStrategy(id: string, name: string, pineScript: string): PineStrategyDefinition {
    return {
        id,
        name,
        description: `Test strategy ${name}`,
        bestMarketConditions: ['trending_bullish'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2,
        defaultSlPercent: 1,
        pineScript,
    };
}

export function runDeterministicBacktestTests(): void {
    console.log('Running Deterministic Backtester Execution Tests...\n');

    // ------------------------------------------------------------
    // Test 1: Long Position Exits at TP
    // ------------------------------------------------------------
    {
        const candles: Candle[] = generateBaseCandles(55, 100);
        // Bar 51: Entry triggers
        // Bar 52: Next bar opens at 100, spikes up to high 112 (TP 110 hit)
        candles[52] = { timestamp: 53 * 60000, open: 100, high: 112, low: 99, close: 111, volume: 1000 };
        candles[53] = { timestamp: 54 * 60000, open: 111, high: 112, low: 110, close: 111, volume: 1000 };

        const strategy = createTestStrategy(
            'test_long_tp',
            'Test Long TP',
            `
//@version=5
strategy("Test Long TP", overlay=true)
if bar_index == 51
    strategy.entry("Long", strategy.long)
    strategy.exit("TP/SL", "Long", profit=110, loss=90)
`
        );

        const candleMap = new Map<string, Candle[]>([['5m', candles]]);
        const result = Backtester.run({
            strategy,
            candleMap,
            options: {
                baseTimeframe: '5m',
                windowBars: 60,
                warmupBars: 0,
                fees: { entryPct: 0, exitPct: 0 },
                slippage: { entryPct: 0, exitPct: 0 },
            },
        });

        const validation = Backtester.validate(result);
        if (!validation.valid) {
            throw new Error(`Validation failed for test_long_tp: ${JSON.stringify(validation.issues)}`);
        }

        if (result.totalTrades !== 1) throw new Error(`Expected 1 trade, got ${result.totalTrades}`);
        const trade = result.trades[0];
        if (trade.side !== 'long') throw new Error(`Expected trade side long, got ${trade.side}`);
        if (trade.exitReason !== 'tp') throw new Error(`Expected exitReason tp, got ${trade.exitReason}`);
        if (trade.exitPrice !== 110) throw new Error(`Expected exitPrice 110, got ${trade.exitPrice}`);
        if (trade.netPnlPercent <= 0) throw new Error(`Expected netPnlPercent > 0, got ${trade.netPnlPercent}`);
        console.log('✅ Test 1 Passed: Long -> TP');
    }

    // ------------------------------------------------------------
    // Test 2: Long Position Exits at SL
    // ------------------------------------------------------------
    {
        const candles: Candle[] = generateBaseCandles(55, 100);
        // Bar 51: Entry triggers
        // Bar 52: Drops to low 88 (SL 90 hit)
        candles[52] = { timestamp: 53 * 60000, open: 100, high: 102, low: 88, close: 89, volume: 1000 };
        candles[53] = { timestamp: 54 * 60000, open: 89, high: 90, low: 88, close: 89, volume: 1000 };

        const strategy = createTestStrategy(
            'test_long_sl',
            'Test Long SL',
            `
//@version=5
strategy("Test Long SL", overlay=true)
if bar_index == 51
    strategy.entry("Long", strategy.long)
    strategy.exit("TP/SL", "Long", profit=120, loss=90)
`
        );

        const candleMap = new Map<string, Candle[]>([['5m', candles]]);
        const result = Backtester.run({
            strategy,
            candleMap,
            options: {
                baseTimeframe: '5m',
                windowBars: 60,
                warmupBars: 0,
                fees: { entryPct: 0, exitPct: 0 },
                slippage: { entryPct: 0, exitPct: 0 },
            },
        });

        const validation = Backtester.validate(result);
        if (!validation.valid) {
            throw new Error(`Validation failed for test_long_sl: ${JSON.stringify(validation.issues)}`);
        }

        if (result.totalTrades !== 1) throw new Error(`Expected 1 trade, got ${result.totalTrades}`);
        const trade = result.trades[0];
        if (trade.side !== 'long') throw new Error(`Expected trade side long, got ${trade.side}`);
        if (trade.exitReason !== 'sl') throw new Error(`Expected exitReason sl, got ${trade.exitReason}`);
        if (trade.exitPrice !== 90) throw new Error(`Expected exitPrice 90, got ${trade.exitPrice}`);
        if (trade.netPnlPercent >= 0) throw new Error(`Expected netPnlPercent < 0, got ${trade.netPnlPercent}`);
        console.log('✅ Test 2 Passed: Long -> SL');
    }

    // ------------------------------------------------------------
    // Test 3: Short Position Exits at TP
    // ------------------------------------------------------------
    {
        const candles: Candle[] = generateBaseCandles(55, 100);
        // Bar 51: Entry triggers
        // Bar 52: Drops to low 88 (Short TP 90 hit)
        candles[52] = { timestamp: 53 * 60000, open: 100, high: 102, low: 88, close: 89, volume: 1000 };
        candles[53] = { timestamp: 54 * 60000, open: 89, high: 90, low: 88, close: 89, volume: 1000 };

        const strategy = createTestStrategy(
            'test_short_tp',
            'Test Short TP',
            `
//@version=5
strategy("Test Short TP", overlay=true)
if bar_index == 51
    strategy.entry("Short", strategy.short)
    strategy.exit("TP/SL", "Short", profit=90, loss=115)
`
        );

        const candleMap = new Map<string, Candle[]>([['5m', candles]]);
        const result = Backtester.run({
            strategy,
            candleMap,
            options: {
                baseTimeframe: '5m',
                windowBars: 60,
                warmupBars: 0,
                fees: { entryPct: 0, exitPct: 0 },
                slippage: { entryPct: 0, exitPct: 0 },
            },
        });

        const validation = Backtester.validate(result);
        if (!validation.valid) {
            throw new Error(`Validation failed for test_short_tp: ${JSON.stringify(validation.issues)}`);
        }

        if (result.totalTrades !== 1) throw new Error(`Expected 1 trade, got ${result.totalTrades}`);
        const trade = result.trades[0];
        if (trade.side !== 'short') throw new Error(`Expected trade side short, got ${trade.side}`);
        if (trade.exitReason !== 'tp') throw new Error(`Expected exitReason tp, got ${trade.exitReason}`);
        if (trade.exitPrice !== 90) throw new Error(`Expected exitPrice 90, got ${trade.exitPrice}`);
        if (trade.netPnlPercent <= 0) throw new Error(`Expected netPnlPercent > 0 for short TP, got ${trade.netPnlPercent}`);
        console.log('✅ Test 3 Passed: Short -> TP');
    }

    // ------------------------------------------------------------
    // Test 4: Short Position Exits at SL
    // ------------------------------------------------------------
    {
        const candles: Candle[] = generateBaseCandles(55, 100);
        // Bar 51: Entry triggers
        // Bar 52: Spikes to high 112 (Short SL 110 hit)
        candles[52] = { timestamp: 53 * 60000, open: 100, high: 112, low: 99, close: 111, volume: 1000 };
        candles[53] = { timestamp: 54 * 60000, open: 111, high: 112, low: 110, close: 111, volume: 1000 };

        const strategy = createTestStrategy(
            'test_short_sl',
            'Test Short SL',
            `
//@version=5
strategy("Test Short SL", overlay=true)
if bar_index == 51
    strategy.entry("Short", strategy.short)
    strategy.exit("TP/SL", "Short", profit=80, loss=110)
`
        );

        const candleMap = new Map<string, Candle[]>([['5m', candles]]);
        const result = Backtester.run({
            strategy,
            candleMap,
            options: {
                baseTimeframe: '5m',
                windowBars: 60,
                warmupBars: 0,
                fees: { entryPct: 0, exitPct: 0 },
                slippage: { entryPct: 0, exitPct: 0 },
            },
        });

        const validation = Backtester.validate(result);
        if (!validation.valid) {
            throw new Error(`Validation failed for test_short_sl: ${JSON.stringify(validation.issues)}`);
        }

        if (result.totalTrades !== 1) throw new Error(`Expected 1 trade, got ${result.totalTrades}`);
        const trade = result.trades[0];
        if (trade.side !== 'short') throw new Error(`Expected trade side short, got ${trade.side}`);
        if (trade.exitReason !== 'sl') throw new Error(`Expected exitReason sl, got ${trade.exitReason}`);
        if (trade.exitPrice !== 110) throw new Error(`Expected exitPrice 110, got ${trade.exitPrice}`);
        if (trade.netPnlPercent >= 0) throw new Error(`Expected netPnlPercent < 0 for short SL, got ${trade.netPnlPercent}`);
        console.log('✅ Test 4 Passed: Short -> SL');
    }

    // ------------------------------------------------------------
    // Test 5: Same-bar TP/SL Ambiguity (Conservative vs Target First)
    // ------------------------------------------------------------
    {
        const candles: Candle[] = generateBaseCandles(55, 100);
        // Bar 52: Touches both TP (110) and SL (90)
        candles[52] = { timestamp: 53 * 60000, open: 100, high: 115, low: 85, close: 105, volume: 1000 };
        candles[53] = { timestamp: 54 * 60000, open: 105, high: 106, low: 104, close: 105, volume: 1000 };

        const strategy = createTestStrategy(
            'test_ambiguity',
            'Test Ambiguity',
            `
//@version=5
strategy("Test Ambiguity", overlay=true)
if bar_index == 51
    strategy.entry("Long", strategy.long)
    strategy.exit("TP/SL", "Long", profit=110, loss=90)
`
        );

        const candleMap = new Map<string, Candle[]>([['5m', candles]]);

        // Conservative policy
        const resConservative = Backtester.run({
            strategy,
            candleMap,
            options: {
                baseTimeframe: '5m',
                windowBars: 60,
                warmupBars: 0,
                execution: { sameBarExitPolicy: 'conservative' },
            },
        });
        if (resConservative.trades[0].exitReason !== 'sl') {
            throw new Error(`Conservative policy should choose SL, got ${resConservative.trades[0].exitReason}`);
        }

        // Target-first policy
        const resTargetFirst = Backtester.run({
            strategy,
            candleMap,
            options: {
                baseTimeframe: '5m',
                windowBars: 60,
                warmupBars: 0,
                execution: { sameBarExitPolicy: 'target_first' },
            },
        });
        if (resTargetFirst.trades[0].exitReason !== 'tp') {
            throw new Error(`Target-first policy should choose TP, got ${resTargetFirst.trades[0].exitReason}`);
        }

        console.log('✅ Test 5 Passed: Same-bar TP/SL Ambiguity Handling');
    }

    // ------------------------------------------------------------
    // Test 6: Fee & Slippage Accounting Chain
    // ------------------------------------------------------------
    {
        const candles: Candle[] = generateBaseCandles(55, 100);
        // Bar 52: Spikes to high 112 (TP 110 hit)
        candles[52] = { timestamp: 53 * 60000, open: 100, high: 112, low: 99, close: 111, volume: 1000 };
        candles[53] = { timestamp: 54 * 60000, open: 111, high: 112, low: 110, close: 111, volume: 1000 };

        const strategy = createTestStrategy(
            'test_fees_slippage',
            'Test Fees Slippage',
            `
//@version=5
strategy("Test Fees", overlay=true)
if bar_index == 51
    strategy.entry("Long", strategy.long)
    strategy.exit("TP/SL", "Long", profit=110, loss=90)
`
        );

        const candleMap = new Map<string, Candle[]>([['5m', candles]]);
        const result = Backtester.run({
            strategy,
            candleMap,
            options: {
                baseTimeframe: '5m',
                windowBars: 60,
                warmupBars: 0,
                capital: { initial: 10000, enabled: true },
                fees: { entryPct: 0.04, exitPct: 0.04 },
                slippage: { entryPct: 0.03, exitPct: 0.03 },
            },
        });

        const validation = Backtester.validate(result);
        if (!validation.valid) {
            throw new Error(`Validation failed for test_fees_slippage: ${JSON.stringify(validation.issues)}`);
        }

        const trade = result.trades[0];
        if (trade.feePercent <= 0) throw new Error('Expected feePercent > 0');
        if (trade.slippagePercent <= 0) throw new Error('Expected slippagePercent > 0');
        if (trade.grossPnlPercent <= trade.netPnlPercent) {
            throw new Error('Expected grossPnlPercent > netPnlPercent due to fees and slippage');
        }
        console.log('✅ Test 6 Passed: Fee and Slippage Accounting Chain');
    }

    console.log('\n🎉 All Deterministic Backtester Execution Tests Passed Successfully!');
}

if (typeof require !== 'undefined' && require.main === module) {
    runDeterministicBacktestTests();
}
