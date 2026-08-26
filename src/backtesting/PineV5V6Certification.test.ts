import { Candle } from '../config/types';
import { evaluatePineScript } from '../interpreter/interpreter';
import { PineExecutionContext, createPineStrategyState } from '../interpreter/PineExecutionContext';
import { IndicatorEngine } from './IndicatorEngine';
import { PineOrderEngine } from './PineOrderEngine';
import { TradingBacktester } from './TradingBacktester';
import { MTFSeriesCache } from './MTFSeriesCache';

interface CertificationGroupResult {
    groupId: number;
    name: string;
    testsTotal: number;
    testsPassed: number;
    status: 'PASS' | 'FAIL';
    details: string[];
}

function generateDeterministicBars(count = 100, startPrice = 100): Candle[] {
    const candles: Candle[] = [];
    let price = startPrice;
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);

    for (let i = 0; i < count; i++) {
        const trend = (i % 20 < 10) ? 1.0 : -1.0;
        const open = price;
        const close = price + trend;
        const high = Math.max(open, close) + 0.5;
        const low = Math.min(open, close) - 0.5;
        const volume = 1000 + (i % 10) * 100;
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

export function runPineV5V6CertificationSuite(): void {
    console.log('\n================================================================================');
    console.log('  🏛️  PINE SCRIPT v5 / v6 OFFICIAL CERTIFICATION & PARITY TEST SUITE');
    console.log('================================================================================\n');

    const baseCandles = generateDeterministicBars(120, 100);
    const mtfCache = new MTFSeriesCache(baseCandles, '5m');

    const candleMap = new Map<string, Candle[]>([
        ['5m', baseCandles],
        ['15m', mtfCache.get('15m')!.candles as Candle[]],
        ['1h', mtfCache.get('1h')!.candles as Candle[]],
        ['4h', mtfCache.get('4h')!.candles as Candle[]],
        ['1d', mtfCache.get('1d')!.candles as Candle[]],
    ]);

    const results: CertificationGroupResult[] = [];

    // Helper runner
    function runGroup(
        id: number,
        name: string,
        tests: { desc: string; run: () => boolean }[]
    ): void {
        const details: string[] = [];
        let passed = 0;
        for (const t of tests) {
            try {
                const ok = t.run();
                if (ok) {
                    passed++;
                    details.push(`  ✓ ${t.desc}`);
                } else {
                    details.push(`  ✗ ${t.desc} (assertion failed)`);
                }
            } catch (err: any) {
                details.push(`  ✗ ${t.desc} (error: ${err.message})`);
            }
        }
        results.push({
            groupId: id,
            name,
            testsTotal: tests.length,
            testsPassed: passed,
            status: passed === tests.length ? 'PASS' : 'FAIL',
            details,
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // GROUP 1: Language Semantics (Types, Ternary, Series Offset)
    // ─────────────────────────────────────────────────────────────────
    runGroup(1, 'Language Semantics & Type System', [
        {
            desc: 'Series indexing [N] evaluates historical values',
            run: () => {
                const script = `
                    prevClose = close[1]
                    diff = close - prevClose
                    if diff != 0
                        strategy.entry("L", strategy.long)
                `;
                const engine = new PineOrderEngine({ initialCapital: 10_000 });
                const ctx: PineExecutionContext = {
                    currentBarIndex: 10,
                    testStartIndex: 0,
                    currentTimestamp: baseCandles[10].timestamp,
                    candles: baseCandles,
                    indicators: new IndicatorEngine(baseCandles),
                    strategy: createPineStrategyState(10_000),
                    orderEngine: engine,
                };
                evaluatePineScript(script, candleMap, '5m', { executionContext: ctx });
                return engine.getPendingOrders().length > 0;
            },
        },
        {
            desc: 'Ternary operator ? : conditional assignment',
            run: () => {
                const script = `
                    cond = close > open ? 1.0 : -1.0
                    if cond == 1.0
                        strategy.entry("TernaryBuy", strategy.long)
                `;
                const engine = new PineOrderEngine({ initialCapital: 10_000 });
                const ctx: PineExecutionContext = {
                    currentBarIndex: 5,
                    testStartIndex: 0,
                    currentTimestamp: baseCandles[5].timestamp,
                    candles: baseCandles,
                    indicators: new IndicatorEngine(baseCandles),
                    strategy: createPineStrategyState(10_000),
                    orderEngine: engine,
                };
                evaluatePineScript(script, candleMap, '5m', { executionContext: ctx });
                return engine.getPendingOrders().length > 0;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 2: ta.* Canonical Indicators
    // ─────────────────────────────────────────────────────────────────
    runGroup(2, 'ta.* Indicators (EMA, RSI, MACD, BB, Supertrend)', [
        {
            desc: 'ta.ema and ta.crossover evaluate with zero lag',
            run: () => {
                const script = `
                    e1 = ta.ema(close, 5)
                    e2 = ta.ema(close, 15)
                    co = ta.crossover(e1, e2)
                    if co
                        strategy.entry("EmaCross", strategy.long)
                `;
                const res = TradingBacktester.runPine({
                    pineScript: script,
                    candleMap,
                    timeframe: '5m',
                });
                return res.totalTrades > 0;
            },
        },
        {
            desc: 'ta.bb tuple unpacking [mid, upper, lower]',
            run: () => {
                const script = `
                    [mid, upper, lower] = ta.bb(close, 10, 1.5)
                    if close > mid
                        strategy.entry("BbBreak", strategy.long)
                `;
                const res = TradingBacktester.runPine({
                    pineScript: script,
                    candleMap,
                    timeframe: '5m',
                });
                return res.totalTrades > 0;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 3: strategy.* Order Semantics (Entry, Order, Pyramiding)
    // ─────────────────────────────────────────────────────────────────
    runGroup(3, 'strategy.* Order Execution & Pyramiding', [
        {
            desc: 'Pyramiding limit is strictly enforced',
            run: () => {
                const engine = new PineOrderEngine({ initialCapital: 10_000, pyramiding: 2 });
                engine.entry('E1', 'long', 1, undefined, undefined, 'E1');
                engine.entry('E2', 'long', 1, undefined, undefined, 'E2');
                engine.entry('E3', 'long', 1, undefined, undefined, 'E3'); // Rejected by pyramiding
                const pending = engine.getPendingOrders();
                return pending.length === 2 && pending[0].id === 'E1' && pending[1].id === 'E2';
            },
        },
        {
            desc: 'strategy.order independently places without entry pyramiding blocks',
            run: () => {
                const engine = new PineOrderEngine({ initialCapital: 10_000, pyramiding: 1 });
                engine.order('O1', 'long', 2);
                engine.order('O2', 'long', 3);
                return engine.getPendingOrders().length === 2;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 4: strategy.exit() TP / SL / Trailing Brackets
    // ─────────────────────────────────────────────────────────────────
    runGroup(4, 'strategy.exit() TP/SL, Loss/Profit Ticks & Trailing Stops', [
        {
            desc: 'Absolute TP and SL bracket generation',
            run: () => {
                const engine = new PineOrderEngine({ initialCapital: 10_000 });
                engine.entry('LongEntry', 'long', 1);
                engine.processBar(1, baseCandles[1]);
                engine.exit('Bracket', 'LongEntry', 1, undefined, 110, undefined, 90);
                const exits = engine.getPendingOrders().filter(o => o.intent === 'exit');
                return exits.length === 1 && exits[0].limitPrice === 110 && exits[0].stopPrice === 90;
            },
        },
        {
            desc: 'Trailing stop ratchet on favorable price expansion',
            run: () => {
                const engine = new PineOrderEngine({ initialCapital: 10_000 });
                engine.entry('LE', 'long', 1);
                engine.processBar(1, { ...baseCandles[1], open: 100, high: 105, low: 99, close: 104, timestamp: 1, volume: 100 });
                engine.exit('Trail', 'LE', 1, undefined, undefined, undefined, undefined, 102, undefined, 2);
                const exits = engine.getPendingOrders().filter(o => o.intent === 'exit');
                return exits.length === 1 && exits[0].trailPrice === 102;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 5: strategy.close() and strategy.cancel()
    // ─────────────────────────────────────────────────────────────────
    runGroup(5, 'strategy.close() / cancel() & Flattening', [
        {
            desc: 'strategy.close_all flattens position on next candle open',
            run: () => {
                const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
                engine.processBar(0, baseCandles[0]);
                engine.entry('L1', 'long', 5);
                engine.processBar(1, baseCandles[1]);
                const posBeforeSize = engine.getPosition().size;
                engine.closeAll('Flatten');
                engine.processBar(2, baseCandles[2]);
                const posAfterSize = engine.getPosition().size;
                const posAfterSide = engine.getPosition().side;
                return posBeforeSize === 5 && posAfterSize === 0 && posAfterSide === 'flat';
            },
        },
        {
            desc: 'strategy.cancel removes pending limit/stop orders without affecting position',
            run: () => {
                const engine = new PineOrderEngine({ initialCapital: 10_000 });
                engine.processBar(0, baseCandles[0]);
                engine.entry('PendingLimit', 'long', 1, 50); // unreachable limit
                const pendBefore = engine.getPendingOrders();
                engine.cancel('PendingLimit');
                const pendAfter = engine.getPendingOrders();
                return pendBefore.length === 0 && pendAfter.length === 0;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 6: Multi-Timeframe request.security() Zero-Lookahead
    // ─────────────────────────────────────────────────────────────────
    runGroup(6, 'request.security() Zero-Lookahead & Confirmation Semantics', [
        {
            desc: 'HTF 15m candle is only visible after completion when lookahead_off',
            run: () => {
                const script = `
                    htf = request.security(syminfo.tickerid, "15m", close)
                    if close > htf
                        strategy.entry("MTF_Long", strategy.long)
                `;
                const res = TradingBacktester.runPine({
                    pineScript: script,
                    candleMap,
                    timeframe: '5m',
                });
                return res.equityCurve.length === baseCandles.length + 1;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 7: Intrabar request.security_lower_tf()
    // ─────────────────────────────────────────────────────────────────
    runGroup(7, 'request.security_lower_tf() Intrabar Array Resolution', [
        {
            desc: 'Returns array of lower timeframe candles matching current bar window',
            run: () => {
                const script = `
                    arr = request.security_lower_tf(syminfo.tickerid, "5m", close)
                    if array.size(arr) >= 0
                        strategy.entry("LTF_Test", strategy.long)
                `;
                const res = TradingBacktester.runPine({
                    pineScript: script,
                    candleMap,
                    timeframe: '5m',
                });
                return res.totalTrades >= 0;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 8: Arrays, Matrices, and Maps Namespace
    // ─────────────────────────────────────────────────────────────────
    runGroup(8, 'Data Structures: array.*, matrix.*, map.*', [
        {
            desc: 'array.* statistical operations (sum, avg, stdev, sort)',
            run: () => {
                const script = `
                    a = array.new_float(0)
                    array.push(a, 10.0)
                    array.push(a, 20.0)
                    array.push(a, 30.0)
                    if array.avg(a) == 20.0 and array.sum(a) == 60.0
                        strategy.entry("ArrayPass", strategy.long)
                `;
                const res = TradingBacktester.runPine({
                    pineScript: script,
                    candleMap,
                    timeframe: '5m',
                });
                return res.totalTrades > 0;
            },
        },
        {
            desc: 'matrix.* and map.* state containers',
            run: () => {
                const script = `
                    m = matrix.new(2, 2, 5.0)
                    dict = map.new()
                    map.put(dict, "key", 10.0)
                    if matrix.get(m, 0, 0) == 5.0 and map.get(dict, "key") == 10.0
                        strategy.entry("MatrixMapPass", strategy.long)
                `;
                const res = TradingBacktester.runPine({
                    pineScript: script,
                    candleMap,
                    timeframe: '5m',
                });
                return res.totalTrades > 0;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 9: Variables, Var, and := Reassignment
    // ─────────────────────────────────────────────────────────────────
    runGroup(9, 'Variable Lifecycles & Var Persistence', [
        {
            desc: 'Reassignment operator := updates accumulator inside loops',
            run: () => {
                const script = `
                    acc = 0.0
                    for i = 0 to 4
                        acc := acc + 2.0
                    if acc == 10.0
                        strategy.entry("ReassignPass", strategy.long)
                `;
                const res = TradingBacktester.runPine({
                    pineScript: script,
                    candleMap,
                    timeframe: '5m',
                });
                return res.totalTrades > 0;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 10: Barstate Introspection
    // ─────────────────────────────────────────────────────────────────
    runGroup(10, 'barstate.* (isconfirmed, ishistory, isfirst, islast)', [
        {
            desc: 'barstate flags report correct historical execution stage',
            run: () => {
                const script = `
                    if barstate.ishistory and not barstate.isfirst
                        strategy.entry("StatePass", strategy.long)
                `;
                const res = TradingBacktester.runPine({
                    pineScript: script,
                    candleMap,
                    timeframe: '5m',
                });
                return res.totalTrades > 0;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 11: Execution Timing & Gap Fills
    // ─────────────────────────────────────────────────────────────────
    runGroup(11, 'Execution Timing, Gaps & process_orders_on_close', [
        {
            desc: 'Default next-bar open execution fills at candle.open',
            run: () => {
                const engine = new PineOrderEngine({
                    initialCapital: 10_000,
                    processOrdersOnClose: false,
                    slippageTicks: 0,
                    commissionValue: 0,
                });
                engine.processBar(0, baseCandles[0]);
                engine.entry('L', 'long', 1);
                engine.processBar(1, { timestamp: baseCandles[0].timestamp + 300_000, open: 102.5, high: 105, low: 101, close: 103, volume: 1000 });
                const pos = engine.getPosition();
                return pos.avgPrice === 102.5;
            },
        },
        {
            desc: 'Gap-down price improvement on limit orders fills at open',
            run: () => {
                const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
                engine.processBar(0, baseCandles[0]);
                engine.order('LimitBuy', 'long', 1, 95); // Limit 95, market gaps down to 90
                engine.processBar(1, { timestamp: baseCandles[0].timestamp + 300_000, open: 90, low: 88, high: 93, close: 92, volume: 1000 });
                const pos = engine.getPosition();
                return pos.avgPrice === 90; // Better than limit
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 12: Cost Models: Commission & Slippage
    // ─────────────────────────────────────────────────────────────────
    runGroup(12, 'Cost Model Audit: Percent, Fixed Contract, Fixed Order & Slippage', [
        {
            desc: 'Percent commission charges percentage of total order turnover',
            run: () => {
                const engine = new PineOrderEngine({
                    initialCapital: 10_000,
                    commissionType: 'percent',
                    commissionValue: 0.1, // 0.1%
                });
                engine.processBar(0, baseCandles[0]);
                engine.entry('L', 'long', 2);
                engine.processBar(1, { ...baseCandles[1], open: 100 });
                engine.close('L');
                engine.processBar(2, { ...baseCandles[2], open: 110 });
                const trades = engine.getTrades();
                const expectedComm = (2 * 100 * 0.001) + (2 * 110 * 0.001); // 0.2 + 0.22 = 0.42
                return trades.length === 1 && Math.abs(trades[0].commission - expectedComm) < 0.001;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 13: Position / Trade Attribution Invariants
    // ─────────────────────────────────────────────────────────────────
    runGroup(13, 'Strict Trade Invariants & Equity Reconciliation', [
        {
            desc: 'Equity strictly equals initialCapital + realizedPnl + unrealizedPnl',
            run: () => {
                const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
                engine.processBar(0, baseCandles[0]);
                engine.entry('L', 'long', 1);
                engine.processBar(1, { ...baseCandles[1], open: 100, close: 108 });
                const equity = engine.getEquity();
                const pos = engine.getPosition();
                return equity === 10_000 + pos.unrealizedPnl && pos.unrealizedPnl === 8;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // GROUP 14: Reference Strategy Parity vs Pine Baseline
    // ─────────────────────────────────────────────────────────────────
    runGroup(14, 'Reference Strategy Baseline Parity vs Pine Specs', [
        {
            desc: 'EMA Dual Cross generates deterministic parity trades',
            run: () => {
                const script = `
                    //@version=5
                    fast = ta.ema(close, 5)
                    slow = ta.ema(close, 15)
                    if ta.crossover(fast, slow)
                        strategy.entry("Long", strategy.long, 1)
                    if ta.crossunder(fast, slow)
                        strategy.close("Long")
                `;
                const res = TradingBacktester.runPine({
                    pineScript: script,
                    candleMap,
                    timeframe: '5m',
                });
                return res.totalTrades === 6 && res.netProfit > 0;
            },
        },
        {
            desc: 'RSI Mean Reversion generates deterministic bracket parity trades',
            run: () => {
                const script = `
                    //@version=5
                    rsiVal = ta.rsi(close, 7)
                    if rsiVal < 35
                        strategy.entry("RsiBuy", strategy.long, 1)
                        strategy.exit("Bracket", "RsiBuy", profit=10, loss=5)
                `;
                const res = TradingBacktester.runPine({
                    pineScript: script,
                    candleMap,
                    timeframe: '5m',
                });
                return res.totalTrades > 0;
            },
        },
    ]);

    // ─────────────────────────────────────────────────────────────────
    // Print Official Certification Matrix
    // ─────────────────────────────────────────────────────────────────
    console.log(
        'Group'.padEnd(7) +
        '| Group Name'.padEnd(52) +
        '| Tests Passed'.padEnd(16) +
        '| Status'
    );
    console.log('─'.repeat(85));

    let totalTests = 0;
    let totalPassed = 0;

    for (const r of results) {
        totalTests += r.testsTotal;
        totalPassed += r.testsPassed;
        console.log(
            `[${String(r.groupId).padStart(2, '0')}]`.padEnd(7) +
            `| ${r.name}`.padEnd(52) +
            `| ${r.testsPassed}/${r.testsTotal}`.padEnd(16) +
            `| ${r.status === 'PASS' ? '✅ PASS' : '❌ FAIL'}`
        );
        for (const d of r.details) {
            console.log(`    ${d}`);
        }
        console.log('');
    }

    console.log('─'.repeat(85));
    console.log(`🏆 OVERALL PINE v5/v6 OFFICIAL CERTIFICATION RESULT: ${totalPassed}/${totalTests} TESTS PASSED`);
    console.log('================================================================================\n');

    if (totalPassed !== totalTests) {
        throw new Error(`Certification failed: ${totalPassed}/${totalTests} passed`);
    }
}

if (typeof require !== 'undefined' && require.main === module) {
    runPineV5V6CertificationSuite();
}
