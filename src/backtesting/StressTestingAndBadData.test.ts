// ================================================================
// BreakoutEx AI — Stress Testing & Bad-Data Resilience Tests (Part 22)
// ================================================================

import { Candle } from '../config/types';
import { TradingBacktester } from './TradingBacktester';
import { HistoricalDataValidator } from './HistoricalDataValidator';
import { MarketStressGenerator } from './MarketStressGenerator';

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

export function runStressTestingAndBadDataTests(): void {
    console.log('================================================================');
    console.log('🛡️ BREAKOUTEX AI — STRESS TESTING & BAD-DATA TESTS (PART 22)');
    console.log('================================================================\n');

    const baseTimestamp = 1700000000000 - (1700000000000 % 3600000);
    const cleanCandles = generateCandles(10000, 5, baseTimestamp);

    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', cleanCandles);
    candleMap.set('15m', generateCandles(3500, 15, baseTimestamp));
    candleMap.set('1h', generateCandles(900, 60, baseTimestamp));
    candleMap.set('4h', generateCandles(400, 240, baseTimestamp));

    // ------------------------------------------------------------
    // 1. Testing Historical Data Validator (Bad Data Detection & Repair)
    // ------------------------------------------------------------
    console.log('1. Testing Historical Data Quality Inspector & Auto-Repair...');

    // Construct bad dataset
    const badCandles: Candle[] = cleanCandles.map(c => ({ ...c }));
    badCandles[10] = { ...badCandles[10], timestamp: badCandles[5].timestamp }; // Duplicate
    badCandles[20] = { ...badCandles[20], high: 45000, low: 52000 }; // Inverted High/Low
    badCandles[30] = { ...badCandles[30], volume: -500 }; // Negative Volume

    const report = TradingBacktester.validateData(badCandles, { mode: 'REPAIR' });

    if (report.issues.length === 0 || report.duplicateCandlesCount !== 1 || report.invalidOhlcCount !== 1) {
        throw new Error('Test 1 Failed: Data Quality inspector failed to catch bad data issues');
    }

    if (!report.repairedCandles || report.repairedCandles.length === 0) {
        throw new Error('Test 1 Failed: Auto-repair did not return clean candles');
    }

    console.log(`✅ Test 1 Passed: Bad data detected & auto-repaired:`);
    console.log(`   • Original Candles:   ${report.totalCandles}`);
    console.log(`   • Repaired Candles:   ${report.validCandles}`);
    console.log(`   • Duplicates Found:   ${report.duplicateCandlesCount}`);
    console.log(`   • Invalid OHLC Bounds:${report.invalidOhlcCount}`);
    console.log(`   • Data Quality Score: ${report.qualityScore}/100 (Usable: ${report.isUsable})`);

    // ------------------------------------------------------------
    // 2. Testing Market Stress Generators
    // ------------------------------------------------------------
    console.log('\n2. Testing Market Stress Injection Scenarios...');

    const flashCrashCandles = MarketStressGenerator.injectStressScenario(cleanCandles, 'FLASH_CRASH');
    const flashPumpCandles = MarketStressGenerator.injectStressScenario(cleanCandles, 'FLASH_PUMP');
    const volExpCandles = MarketStressGenerator.injectStressScenario(cleanCandles, 'VOLATILITY_EXPLOSION');

    const midIdx = Math.floor(cleanCandles.length * 0.5);
    const dropPct = (cleanCandles[midIdx].open - flashCrashCandles[midIdx + 1].close) / cleanCandles[midIdx].open;

    if (dropPct < 0.15) {
        throw new Error('Test 2 Failed: Flash Crash generator failed to create steep price drop');
    }

    console.log(`✅ Test 2 Passed: Synthetic stress scenarios generated:`);
    console.log(`   • Flash Crash:        - ${(dropPct * 100).toFixed(1)}% price drop injected`);
    console.log(`   • Volatility Shock:   4x ATR range expansion injected`);

    // ------------------------------------------------------------
    // 3. Testing Full Strategy Stress Test Suite
    // ------------------------------------------------------------
    console.log('\n3. Testing Automated Strategy Stress Test Suite...');

    const stressReport = TradingBacktester.runStressTest({
        strategy: 'mtf_trend_continuation',
        candleMap,
        options: { windowBars: 2000 },
    });

    if (!stressReport || !stressReport.scenarioResults || stressReport.scenarioResults.length === 0) {
        throw new Error('Test 3 Failed: Stress test report generation failed');
    }

    console.log(`✅ Test 3 Passed: Strategy Stress Test completed:`);
    console.log(`   • Strategy:               ${stressReport.strategyName}`);
    console.log(`   • Baseline Return:        ${stressReport.baselineResult.totalReturnPercent?.toFixed(2)}%`);
    console.log(`   • Worst Stress Scenario:  ${stressReport.worstScenarioName} (Max DD: ${stressReport.maxStressDrawdownPercent}%)`);
    console.log(`   • Avg Stress Return:      ${stressReport.avgStressReturnPercent}%`);
    console.log(`   • Stress Resilience Score: ${stressReport.stressResilienceScore}/100`);
    console.log(`   • Stress Verdict:         ${stressReport.verdict}`);

    console.log('\n--- 🧪 Stress Scenarios Summary ---');
    for (const sc of stressReport.scenarioResults) {
        console.log(`   • [${sc.survived ? 'SURVIVED' : 'FAILED'}] ${sc.scenarioName.padEnd(20)} | Return: ${sc.returnPercent.toFixed(2)}% | Max DD: ${sc.maxDrawdownPercent}%`);
    }

    console.log('\n🎉 All Part 22 Stress Testing & Bad-Data Tests Passed Successfully!');
}

if (typeof require !== 'undefined' && require.main === module) {
    runStressTestingAndBadDataTests();
}
