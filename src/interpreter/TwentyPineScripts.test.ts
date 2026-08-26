import { Candle } from '../config/types';
import { evaluatePineScript } from './interpreter';
import { PineExecutionContext, createPineStrategyState } from './PineExecutionContext';
import { IndicatorEngine } from '../backtesting/IndicatorEngine';
import { PineOrderEngine } from '../backtesting/PineOrderEngine';
import { TradingBacktester } from '../backtesting/TradingBacktester';

function generateCandles(count: number, startPrice = 100): Candle[] {
    const candles: Candle[] = [];
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);

    for (let i = 0; i < count; i++) {
        const trend = Math.sin(i / 5) * 10;
        const open = startPrice + trend;
        const close = open + (i % 2 === 0 ? 1.5 : -1.5);
        const high = Math.max(open, close) + 1.0;
        const low = Math.min(open, close) - 1.0;
        const volume = 1000 + (i % 5) * 100;
        candles.push({
            timestamp: start + i * 5 * 60_000,
            open,
            high,
            low,
            close,
            volume,
        });
    }
    return candles;
}

export function test20DiversePineScripts(): void {
    console.log('\n================================================================');
    console.log('  🧪 COMPREHENSIVE TEST CORPUS: 20 DIVERSE PINE SCRIPTS');
    console.log('================================================================\n');

    const candles = generateCandles(100, 100);
    const candleMap = new Map<string, Candle[]>([['5m', candles]]);

    const scripts: { id: number; name: string; script: string; expectOrders: boolean }[] = [
        // 1. Classic Dual EMA Trend
        {
            id: 1,
            name: 'Dual EMA Cross',
            script: `
                //@version=5
                fast = ta.ema(close, 9)
                slow = ta.ema(close, 21)
                if ta.crossover(fast, slow)
                    strategy.entry("Long", strategy.long)
                if ta.crossunder(fast, slow)
                    strategy.close("Long")
            `,
            expectOrders: true,
        },
        // 2. RSI Extreme Reversal with Bracket
        {
            id: 2,
            name: 'RSI Oversold/Overbought Bracket',
            script: `
                //@version=5
                rsi = ta.rsi(close, 7)
                if rsi < 40
                    strategy.entry("RsiBuy", strategy.long)
                    strategy.exit("RsiExit", "RsiBuy", profit=10, loss=5)
            `,
            expectOrders: true,
        },
        // 3. Bollinger Bands Mean Reversion
        {
            id: 3,
            name: 'Bollinger Band Squeeze Breakout',
            script: `
                //@version=5
                [middle, upper, lower] = ta.bb(close, 20, 2)
                if close < lower
                    strategy.entry("BB_Long", strategy.long)
                if close > middle
                    strategy.close("BB_Long")
            `,
            expectOrders: true,
        },
        // 4. MACD Histogram Momentum
        {
            id: 4,
            name: 'MACD Histogram Expansion',
            script: `
                //@version=5
                [macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)
                if hist > 0 and hist[1] <= 0
                    strategy.entry("MacdLong", strategy.long)
                if hist < 0
                    strategy.close("MacdLong")
            `,
            expectOrders: true,
        },
        // 5. Supertrend ATR Trend Follower
        {
            id: 5,
            name: 'Supertrend Trend Follower',
            script: `
                //@version=5
                [st, dir] = ta.supertrend(3, 10)
                if dir == -1 and dir[1] == 1
                    strategy.entry("ST_Long", strategy.long)
                if dir == 1
                    strategy.close("ST_Long")
            `,
            expectOrders: true,
        },
        // 6. Stochastic RSI Dynamic Filter
        {
            id: 6,
            name: 'Stochastic RSI Momentum Cross',
            script: `
                //@version=5
                [k, d] = ta.stochRsi(close, 14, 14, 3, 3)
                if ta.crossover(k, d) and k < 20
                    strategy.entry("StochLong", strategy.long)
                if k > 80
                    strategy.close("StochLong")
            `,
            expectOrders: true,
        },
        // 7. Donchian Channel High/Low Breakout with Trailing Stop
        {
            id: 7,
            name: 'Donchian Breakout Trailing Stop',
            script: `
                //@version=5
                upper = ta.highest(high, 20)
                lower = ta.lowest(low, 20)
                if high >= upper[1]
                    strategy.entry("Donchian", strategy.long)
                    strategy.exit("Trail", "Donchian", trail_points=5, trail_offset=5)
            `,
            expectOrders: true,
        },
        // 8. Keltner Channel Volatility Squeeze
        {
            id: 8,
            name: 'Keltner Channel Mean Reversion',
            script: `
                //@version=5
                [kUpper, kLower, kMid] = ta.keltner(close, 20, 1.5, 10)
                if close <= kLower
                    strategy.entry("KeltnerLong", strategy.long)
                if close >= kMid
                    strategy.close("KeltnerLong")
            `,
            expectOrders: true,
        },
        // 9. ADX / DMI Directional Strength
        {
            id: 9,
            name: 'ADX Trend Strength Filter',
            script: `
                //@version=5
                [adxVal, diPlus, diMinus] = ta.adx(14)
                if diPlus > diMinus and adxVal > 20
                    strategy.entry("ADX_Long", strategy.long)
                if diMinus > diPlus
                    strategy.close("ADX_Long")
            `,
            expectOrders: true,
        },
        // 10. Volume-Weighted Average Price (VWAP)
        {
            id: 10,
            name: 'VWAP Reversion',
            script: `
                //@version=5
                vwapVal = ta.vwap()
                if close > vwapVal and close[1] <= vwapVal
                    strategy.entry("VWAP_Long", strategy.long)
                if close < vwapVal
                    strategy.close("VWAP_Long")
            `,
            expectOrders: true,
        },
        // 11. Multi-Timeframe (MTF) HTF EMA Confirmation
        {
            id: 11,
            name: 'MTF 15m Trend Confirmation',
            script: `
                //@version=5
                htfEma = request.security(syminfo.tickerid, "15m", ta.ema(close, 20))
                if close > htfEma and ta.crossover(ta.ema(close, 5), ta.ema(close, 10))
                    strategy.entry("MTF_Long", strategy.long)
                if close < htfEma
                    strategy.close("MTF_Long")
            `,
            expectOrders: true,
        },
        // 12. Array-Driven Moving Average Filter
        {
            id: 12,
            name: 'Array Buffer & Moving Window Calculation',
            script: `
                //@version=5
                buf = array.new_float(0)
                array.push(buf, close)
                array.push(buf, open)
                s = array.sum(buf)
                if s > 0
                    strategy.entry("ArrayLong", strategy.long)
            `,
            expectOrders: true,
        },
        // 13. Matrix Operations
        {
            id: 13,
            name: 'Matrix Data Representation',
            script: `
                //@version=6
                m = matrix.new(2, 2, 0.0)
                matrix.set(m, 0, 0, close)
                val = matrix.get(m, 0, 0)
                if val > 0
                    strategy.entry("MatrixPass", strategy.long)
            `,
            expectOrders: true,
        },
        // 14. Map Hash-Map Lookups
        {
            id: 14,
            name: 'Map Key-Value Storage',
            script: `
                //@version=6
                dict = map.new()
                map.put(dict, "threshold", 100.0)
                th = map.get(dict, "threshold")
                if close >= th
                    strategy.entry("MapPass", strategy.long)
            `,
            expectOrders: true,
        },
        // 15. Strategy Order with OCA Groups (One-Cancels-All)
        {
            id: 15,
            name: 'OCA Bracket Orders',
            script: `
                //@version=5
                strategy.order("BuyBreakout", strategy.long, 1, stop=105, oca_name="OCA1", oca_type=strategy.oca.cancel)
                strategy.order("SellBreakdown", strategy.short, 1, stop=95, oca_name="OCA1", oca_type=strategy.oca.cancel)
            `,
            expectOrders: true,
        },
        // 16. Multi-Entry Pyramiding
        {
            id: 16,
            name: 'Pyramiding Staggered Scaling',
            script: `
                //@version=5
                ma1 = ta.ema(close, 5)
                ma2 = ta.ema(close, 10)
                if ta.crossover(ma1, ma2)
                    strategy.entry("Pyramid1", strategy.long, 2)
                    strategy.entry("Pyramid2", strategy.long, 2)
                if ta.crossunder(ma1, ma2)
                    strategy.close_all()
            `,
            expectOrders: true,
        },
        // 17. Reversal Semantics (Long to Short)
        {
            id: 17,
            name: 'Immediate Reversal Engine',
            script: `
                //@version=5
                m1 = ta.ema(close, 5)
                m2 = ta.ema(close, 10)
                if ta.crossover(m1, m2)
                    strategy.entry("L", strategy.long, 5)
                if ta.crossunder(m1, m2)
                    strategy.entry("S", strategy.short, 5)
            `,
            expectOrders: true,
        },
        // 18. Barstate & Multi-Timeframe Introspection
        {
            id: 18,
            name: 'Barstate Introspection & Confirmation',
            script: `
                //@version=5
                isConfirmedBar = barstate.isconfirmed or barstate.ishistory
                if isConfirmedBar and not barstate.isfirst
                    strategy.entry("BarstatePass", strategy.long)
            `,
            expectOrders: true,
        },
        // 19. Loops and Ternary
        {
            id: 19,
            name: 'Loop Accumulator & Ternary Filter',
            script: `
                //@version=5
                sum = 0.0
                for i = 0 to 4
                    sum := sum + close[1]
                smoothed = sum / 5.0
                sig = close > smoothed ? true : false
                if sig
                    strategy.entry("LoopPass", strategy.long)
            `,
            expectOrders: true,
        },
        // 20. Multi-Timeframe EMA Filter
        {
            id: 20,
            name: 'MTF 1h EMA Filter',
            script: `
                //@version=5
                htfEma = request.security(syminfo.tickerid, "1h", ta.ema(close, 10))
                if close >= htfEma
                    strategy.entry("MTF_Break", strategy.long)
            `,
            expectOrders: true,
        },
    ];

    console.log(
        '#'.padEnd(4) +
        '| Strategy Description'.padEnd(52) +
        '| Orders / Signals'.padEnd(20) +
        '| Status'
    );
    console.log('─'.repeat(90));

    let passCount = 0;

    for (const test of scripts) {
        const engine = new PineOrderEngine({ initialCapital: 10_000, pyramiding: 5 });
        const strategyState = createPineStrategyState(10_000);
        let totalOrders = 0;
        let finalAction = 'none';

        for (let bar = 10; bar < candles.length; bar++) {
            const execCtx: PineExecutionContext = {
                currentBarIndex: bar,
                testStartIndex: 0,
                currentTimestamp: candles[bar].timestamp,
                candles,
                indicators: new IndicatorEngine(candles),
                strategy: strategyState,
                orderEngine: engine,
            };

            engine.processBar(bar, candles[bar]);
            const signal = evaluatePineScript(test.script, candleMap, '5m', { executionContext: execCtx });
            if (signal.action !== 'none') finalAction = signal.action;
            engine.syncStrategyState(strategyState);
        }

        const trades = engine.getTrades();
        const pending = engine.getPendingOrders();
        const hasActivity = trades.length > 0 || pending.length > 0 || finalAction !== 'none';

        if (!hasActivity && test.expectOrders) {
            console.log(`[${test.id}] ❌ FAIL: ${test.name}`);
            throw new Error(`[Test ${test.id} Failed] ${test.name} did not generate orders or trades`);
        }

        passCount++;
        console.log(
            `[${String(test.id).padStart(2, '0')}]`.padEnd(4) +
            `| ${test.name}`.padEnd(52) +
            `| ${trades.length} trades / ${pending.length} pend`.padEnd(20) +
            '| ✅ PASS'
        );
    }

    console.log('\n' + '─'.repeat(90));
    console.log(`🎉 ALL ${passCount}/${scripts.length} DIVERSE PINE SCRIPT TESTS PASSED!\n`);
}

if (typeof require !== 'undefined' && require.main === module) {
    test20DiversePineScripts();
}
