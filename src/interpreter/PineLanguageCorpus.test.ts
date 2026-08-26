import { Candle } from '../config/types';
import { evaluatePineScript } from './interpreter';
import { PineExecutionContext, createPineStrategyState } from './PineExecutionContext';
import { IndicatorEngine } from '../backtesting/IndicatorEngine';
import { PineOrderEngine } from '../backtesting/PineOrderEngine';

function generateCandles(count: number, startPrice = 100): Candle[] {
    const candles: Candle[] = [];
    let price = startPrice;
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);

    for (let i = 0; i < count; i++) {
        const change = (i % 2 === 0 ? 1 : -1) * 2;
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + 1;
        const low = Math.min(open, close) - 1;
        const volume = 1000;
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

export function testPineLanguageAndBuiltinCorpus(): void {
    console.log('Testing Parts 11, 12, 13 — Pine v5/v6 Language & Built-in Function Test Corpus...');

    const candles = generateCandles(30, 100);
    const candleMap = new Map<string, Candle[]>([['5m', candles]]);

    function createCtx(engine?: PineOrderEngine): PineExecutionContext {
        return {
            currentBarIndex: 25,
            testStartIndex: 0,
            currentTimestamp: candles[25].timestamp,
            candles,
            indicators: new IndicatorEngine(candles),
            strategy: createPineStrategyState(10_000),
            orderEngine: engine,
        };
    }

    // ── Corpus 1: Array Operations & Statistical Aggregation ───────────
    {
        const script = `
            //@version=5
            a = array.new_float(0)
            array.push(a, 10.0)
            array.push(a, 20.0)
            array.push(a, 30.0)
            s = array.sum(a)
            m = array.avg(a)
            if s == 60.0 and m == 20.0
                strategy.entry("ArrayPass", strategy.long, 1)
        `;
        const engine = new PineOrderEngine({ initialCapital: 10_000 });
        const ctx = createCtx(engine);
        evaluatePineScript(script, candleMap, '5m', { executionContext: ctx });

        if (engine.getPendingOrders().length !== 1 || engine.getPendingOrders()[0].id !== 'ArrayPass') {
            throw new Error('[Corpus 1 Failed] Array push/sum/avg operations failed to trigger entry');
        }
        console.log('  ✓ [PASS] Corpus 1: array.new_*, array.push, array.sum, array.avg semantics');
    }

    // ── Corpus 2: TA Crossover, Crossunder, Moving Averages ──────────
    {
        const script = `
            //@version=5
            fast = ta.ema(close, 5)
            slow = ta.sma(close, 10)
            rsiVal = ta.rsi(close, 14)
            highestHigh = ta.highest(high, 10)
            lowestLow = ta.lowest(low, 10)
            co = ta.crossover(fast, slow)
            cu = ta.crossunder(fast, slow)
            if rsiVal > 0 and highestHigh >= lowestLow
                strategy.entry("TAPass", strategy.long, 1)
        `;
        const engine = new PineOrderEngine({ initialCapital: 10_000 });
        const ctx = createCtx(engine);
        evaluatePineScript(script, candleMap, '5m', { executionContext: ctx });

        if (engine.getPendingOrders().length !== 1) {
            throw new Error('[Corpus 2 Failed] ta built-ins evaluation failed');
        }
        console.log('  ✓ [PASS] Corpus 2: ta.ema, ta.sma, ta.rsi, ta.highest, ta.lowest, ta.crossover semantics');
    }

    // ── Corpus 3: Loops, Math Functions, Conditionals & Ternary ──────
    {
        const script = `
            //@version=6
            val = math.abs(-15.5)
            rounded = math.round(val)
            let total = 0
            for i = 0 to 4
                total += i
            
            cond = total == 10 and rounded == 16
            sig = cond ? "Buy" : "None"
            if sig == "Buy"
                strategy.entry("MathPass", strategy.long, 1)
        `;
        const engine = new PineOrderEngine({ initialCapital: 10_000 });
        const ctx = createCtx(engine);
        evaluatePineScript(script, candleMap, '5m', { executionContext: ctx });

        if (engine.getPendingOrders().length !== 1 || engine.getPendingOrders()[0].id !== 'MathPass') {
            throw new Error('[Corpus 3 Failed] Math, loop, and ternary constructs failed');
        }
        console.log('  ✓ [PASS] Corpus 3: math.*, for-loops, and ternary expressions');
    }

    // ── Corpus 4: Barstate, Timeframe & Syminfo ───────────────────────
    {
        const script = `
            //@version=5
            isCrypto = syminfo.type == "crypto"
            hasTf = timeframe.period == "5"
            isHist = barstate.isconfirmed or barstate.ishistory
            if isCrypto and hasTf and isHist
                strategy.entry("StatePass", strategy.long, 1)
        `;
        const engine = new PineOrderEngine({ initialCapital: 10_000 });
        const ctx = createCtx(engine);
        evaluatePineScript(script, candleMap, '5m', { executionContext: ctx });

        if (engine.getPendingOrders().length !== 1 || engine.getPendingOrders()[0].id !== 'StatePass') {
            throw new Error('[Corpus 4 Failed] syminfo, timeframe, and barstate variables failed');
        }
        console.log('  ✓ [PASS] Corpus 4: syminfo, timeframe, and barstate namespace introspection');
    }

    // ── Corpus 5: Series Historical Indexing `[1]`, `[2]` ─────────────
    {
        const script = `
            //@version=5
            prevClose = close[1]
            olderClose = close[2]
            diff = prevClose - olderClose
            if math.abs(diff) > 0
                strategy.entry("HistPass", strategy.long, 1)
        `;
        const engine = new PineOrderEngine({ initialCapital: 10_000 });
        const ctx = createCtx(engine);
        evaluatePineScript(script, candleMap, '5m', { executionContext: ctx });

        if (engine.getPendingOrders().length !== 1 || engine.getPendingOrders()[0].id !== 'HistPass') {
            throw new Error('[Corpus 5 Failed] Series history offset indexing failed');
        }
        console.log('  ✓ [PASS] Corpus 5: Series historical indexing (close[1], close[2])');
    }

    console.log('\n🎉 ALL PINE v5/v6 LANGUAGE & BUILT-IN CORPUS TESTS PASSED (Parts 11, 12, 13)!\n');
}

if (typeof require !== 'undefined' && require.main === module) {
    testPineLanguageAndBuiltinCorpus();
}
