// ================================================================
// BreakoutEx AI Pine Engine — Full Backtest Integration Test
// ================================================================

import { TradingBacktester } from '../backtesting/TradingBacktester';
import { getAllStrategies, STRATEGY_LIBRARY } from '../pine/strategy-library';
import { evaluatePineScript } from '../pine/interpreter';
import { backtestStrategy } from '../pine/backtester';
import { Candle } from '../config/types';

// ─── Candle Generator ────────────────────────────────────────────
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
        const trend = Math.sin(i / 150) * 18;
        const cycle = Math.sin(i / 10) * 25 + Math.cos(i / 5) * 12;
        const noise = (Math.random() - 0.5) * 12;
        const change = trend + cycle + noise;

        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + Math.random() * 18 + 6;
        const low = Math.min(open, close) - Math.random() * 18 - 6;
        const volume = 1000 + Math.random() * 600 + (Math.abs(change) > 25 ? 1200 : 0);

        candles.push({ timestamp: baseTimestamp + i * intervalMs, open, high, low, close, volume });
        price = close;
    }
    return candles;
}

function pass(n: number, msg: string) { console.log(`  ✅ Test ${n}: ${msg}`); }
function fail(n: number, msg: string): never { console.error(`  ❌ Test ${n}: ${msg}`); process.exit(1); }
function section(title: string) { console.log(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`); }

// ─── Setup ───────────────────────────────────────────────────────
const BASE = 1700000000000 - (1700000000000 % 3600000);

// Smaller dataset for fast per-strategy tests (Sections 1–5)
const candleMap = new Map<string, Candle[]>([
    ['5m',  generateCandles(5000, 5,   BASE)],
    ['15m', generateCandles(2000, 15,  BASE)],
    ['1h',  generateCandles(600,  60,  BASE)],
    ['4h',  generateCandles(300,  240, BASE)],
    ['1d',  generateCandles(150,  1440, BASE)],
]);

// Larger dataset for portfolio / realistic / stress tests (Sections 6–8).
// constructPortfolio internally runs WalkForwardEngine which splits data
// 60/20/20. The train split must have enough 4h bars for EMA(200):
// 200 * (240min/5min) = 9600 base 5m bars → need at least ~16000 5m total.
const largeCandleMap = new Map<string, Candle[]>([
    ['5m',  generateCandles(20000, 5,   BASE)],
    ['15m', generateCandles(7000,  15,  BASE)],
    ['1h',  generateCandles(2000,  60,  BASE)],
    ['4h',  generateCandles(800,   240, BASE)],
    ['1d',  generateCandles(300,   1440, BASE)],
]);

const OPTIONS = { windowBars: 1500, warmupBars: 100 };
// No windowBars cap for heavy tests — let the engine use all available data
const HEAVY_OPTIONS = { warmupBars: 100 };

let passed = 0;
let total = 0;
const t = () => ++total;

// ════════════════════════════════════════════════════════════════
// SECTION 1 — All 12 strategies: interpreter + basic backtester
// ════════════════════════════════════════════════════════════════
section('SECTION 1 — All Strategies: Interpreter + Pine Backtester');

const allStrategies = getAllStrategies();
console.log(`  Found ${allStrategies.length} strategies in library.\n`);

for (let i = 0; i < allStrategies.length; i++) {
    const s = allStrategies[i];
    const n = t();
    try {
        const sig = evaluatePineScript(s.pineScript, candleMap, '5m');
        const bt  = backtestStrategy(s, candleMap, '5m', 100);
        if (!sig || !bt) fail(n, `${s.id}: null result`);
        console.log(`  ✅ Test ${n} [${String(i+1).padStart(2,'0')}/${allStrategies.length}] ${s.id.padEnd(36)} | Signal: ${sig.action.padEnd(5)} | Trades: ${bt.totalTrades}, WR: ${bt.winRate}%`);
        passed++;
    } catch (e: any) {
        fail(n, `${s.id}: ${e.message}`);
    }
}

// ════════════════════════════════════════════════════════════════
// SECTION 2 — TradingBacktester.run()
// ════════════════════════════════════════════════════════════════
section('SECTION 2 — TradingBacktester.run()');

{
    // Test: run by strategy definition object
    const n = t();
    const r = TradingBacktester.run({ strategy: STRATEGY_LIBRARY.mtf_trend_continuation, candleMap, options: OPTIONS });
    if (typeof r.netProfit !== 'number') fail(n, 'netProfit not a number');
    pass(n, `run() via definition — "${r.strategyName}" | Trades: ${r.totalTrades}, Return: ${r.totalReturnPercent.toFixed(2)}%, MaxDD: ${r.maxDrawdownPercent.toFixed(2)}%`);
    passed++;
}

{
    // Test: run by strategy ID string
    const n = t();
    const r = TradingBacktester.run({ strategy: 'mtf_supertrend_vwap', candleMap, options: OPTIONS });
    if (r.strategyId !== 'mtf_supertrend_vwap') fail(n, `Wrong strategyId: ${r.strategyId}`);
    pass(n, `run() via string ID — Trades: ${r.totalTrades}, WinRate: ${r.winRate}%`);
    passed++;
}

// ════════════════════════════════════════════════════════════════
// SECTION 3 — TradingBacktester.runPine() raw script
// ════════════════════════════════════════════════════════════════
section('SECTION 3 — TradingBacktester.runPine() raw Pine script');

{
    const n = t();
    const rawPine = `
        //@version=5
        strategy("EMA Cross Test", overlay=true)
        fast = ta.ema(close, 9)
        slow = ta.ema(close, 21)
        if ta.crossover(fast, slow)
            strategy.entry("Long", strategy.long)
        if ta.crossunder(fast, slow)
            strategy.close("Long")
    `;
    const r = TradingBacktester.runPine({ pineScript: rawPine, strategyName: 'EMA Cross Test', candleMap, options: OPTIONS });
    if (r.strategyName !== 'EMA Cross Test') fail(n, 'strategyName mismatch');
    pass(n, `runPine() — Trades: ${r.totalTrades}, Net Profit: $${r.netProfit.toFixed(2)}`);
    passed++;
}

// ════════════════════════════════════════════════════════════════
// SECTION 4 — TradingBacktester.runMany() batch
// ════════════════════════════════════════════════════════════════
section('SECTION 4 — TradingBacktester.runMany() batch execution');

{
    const n = t();
    const ids = ['mtf_trend_continuation', 'mtf_supertrend_vwap', 'mtf_failed_breakout', 'mtf_donchian_breakout'];
    const results = TradingBacktester.runMany({ strategies: ids, candleMap, options: OPTIONS });
    if (results.length !== ids.length) fail(n, `Expected ${ids.length} results, got ${results.length}`);
    results.forEach(r => console.log(`    • ${r.strategyId.padEnd(36)} | Trades: ${r.totalTrades}, Return: ${r.totalReturnPercent.toFixed(2)}%`));
    pass(n, `runMany() returned ${results.length} results`);
    passed++;
}

// ════════════════════════════════════════════════════════════════
// SECTION 5 — TradingBacktester.benchmark()
// ════════════════════════════════════════════════════════════════
section('SECTION 5 — TradingBacktester.benchmark()');

{
    const n = t();
    const report = TradingBacktester.benchmark({
        strategies: ['mtf_trend_continuation', 'mtf_supertrend_vwap', 'mtf_range_breakout'],
        candleMap,
        options: OPTIONS,
    });
    if (report.totalStrategies !== 3) fail(n, `Expected 3, got ${report.totalStrategies}`);
    pass(n, `benchmark() — ${report.overallBarsPerSecond.toLocaleString()} bars/sec, ${report.totalTimeMs}ms total`);
    passed++;
}

// ════════════════════════════════════════════════════════════════
// SECTION 6 — TradingBacktester.constructPortfolio()
// ════════════════════════════════════════════════════════════════
section('SECTION 6 — TradingBacktester.constructPortfolio()');

{
    const n = t();
    const report = TradingBacktester.constructPortfolio({
        strategies: ['mtf_trend_continuation', 'mtf_supertrend_vwap', 'mtf_failed_breakout'],
        candleMap: largeCandleMap,
        allocationModel: 'CLUSTER_BALANCED',
        totalCapital: 10000,
        cashReservePercent: 10,
        options: HEAVY_OPTIONS,
    });
    if (!report || !('portfolioReturnPercent' in report)) fail(n, 'Missing portfolioReturnPercent');
    const r = report as any;
    pass(n, `constructPortfolio() — Strategies allocated: ${r.strategyAllocations?.length ?? '?'}, Portfolio Return: ${r.portfolioReturnPercent?.toFixed(2) ?? '?'}%`);
    passed++;
}

// ════════════════════════════════════════════════════════════════
// SECTION 7 — TradingBacktester.simulateRealisticExecution()
// ════════════════════════════════════════════════════════════════
section('SECTION 7 — TradingBacktester.simulateRealisticExecution()');

{
    const n = t();
    const report = TradingBacktester.simulateRealisticExecution({
        strategy: 'mtf_trend_continuation',
        candleMap: largeCandleMap,
        exchange: 'BINANCE_FUTURES_BTC',
        options: HEAVY_OPTIONS,
    });
    if (!report || !('verdict' in report)) fail(n, 'Missing verdict in report');
    const r = report as any;
    pass(n, `simulateRealisticExecution() — Ideal: ${r.idealResult?.totalReturnPercent?.toFixed(2) ?? '?'}% vs Realistic: ${r.realisticResult?.totalReturnPercent?.toFixed(2) ?? '?'}% | Verdict: ${r.verdict}`);
    passed++;
}

// ════════════════════════════════════════════════════════════════
// SECTION 8 — TradingBacktester.runStressTest()
// ════════════════════════════════════════════════════════════════
section('SECTION 8 — TradingBacktester.runStressTest()');

{
    const n = t();
    const report = TradingBacktester.runStressTest({
        strategy: 'mtf_trend_continuation',
        candleMap: largeCandleMap,
        options: HEAVY_OPTIONS,
    });
    if (!report || !('verdict' in report)) fail(n, 'Missing verdict in stress report');
    const r = report as any;
    pass(n, `runStressTest() — Quality Score: ${r.dataQualityReport?.qualityScore ?? '?'}/100, Verdict: ${r.verdict}`);
    passed++;
}

// ════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`  🎉 ALL TESTS PASSED: ${passed}/${total}`);
console.log(`${'═'.repeat(60)}\n`);
