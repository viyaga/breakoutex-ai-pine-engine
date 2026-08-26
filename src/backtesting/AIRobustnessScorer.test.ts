// ================================================================
// BreakoutEx AI — Robustness, Walk-Forward & Anti-Overfitting Tests
// ================================================================

import { Candle } from '../config/types';
import { TradingBacktester } from './TradingBacktester';
import { STRATEGY_LIBRARY } from './strategy-library';
import { MonteCarloSimulator } from './MonteCarloSimulator';
import { WalkForwardEngine } from './WalkForwardEngine';
import { MarketRegimeClassifier } from './MarketRegimeClassifier';
import { AIRobustnessScorer } from './AIRobustnessScorer';

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
        const trend = Math.sin(i / 100) * 15;
        const cycle = Math.sin(i / 8) * 20 + Math.cos(i / 4) * 10;
        const noise = (Math.random() - 0.5) * 10;
        const change = trend + cycle + noise;

        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + Math.random() * 15 + 5;
        const low = Math.min(open, close) - Math.random() * 15 - 5;
        const volume = 1000 + Math.random() * 500 + (Math.abs(change) > 20 ? 1000 : 0);

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

export function runAIRobustnessTests(): void {
    console.log('================================================================');
    console.log('🛡️ BREAKOUTEX AI — ROBUSTNESS & ANTI-OVERFITTING TEST SUITE');
    console.log('================================================================\n');

    const baseTimestamp = 1700000000000 - (1700000000000 % 3600000);
    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', generateCandles(30000, 5, baseTimestamp));
    candleMap.set('15m', generateCandles(10000, 15, baseTimestamp));
    candleMap.set('1h', generateCandles(2500, 60, baseTimestamp));
    candleMap.set('4h', generateCandles(700, 240, baseTimestamp));

    const strategy = STRATEGY_LIBRARY.mtf_failed_breakout;

    // ------------------------------------------------------------
    // 1. Signal Diagnostics & Zero-Trade Transparency Test
    // ------------------------------------------------------------
    console.log('1. Testing Signal Evaluation & Execution Diagnostics...');
    const btResult = TradingBacktester.run({
        strategy,
        candleMap,
        options: {
            windowBars: 1000,
            warmupBars: 200,
        },
    });

    const diag = btResult.diagnostics;
    if (diag.signalsEvaluated === 0) {
        throw new Error('Test 1 Failed: Expected signalsEvaluated > 0');
    }
    console.log(`✅ Test 1 Passed: Signal transparency verified:`);
    console.log(`   • Bars Evaluated:    ${diag.signalsEvaluated}`);
    console.log(`   • Entry Signals:     ${diag.entrySignals}`);
    console.log(`   • Exit Signals:      ${diag.exitSignals}`);
    console.log(`   • Executed Trades:   ${diag.executedTrades}`);

    // ------------------------------------------------------------
    // 2. Train / Validation / Out-of-Sample Split Analysis
    // ------------------------------------------------------------
    console.log('\n2. Testing Train (60%) / Validation (20%) / Test (20%) Split Analysis...');
    const splitResult = WalkForwardEngine.runSplit({
        strategy,
        candleMap,
        ratios: { train: 0.6, validation: 0.2, test: 0.2 },
        options: { warmupBars: 50 },
    });

    if (!splitResult || typeof splitResult.generalizationScore !== 'number') {
        throw new Error('Test 2 Failed: Expected valid split analysis result');
    }
    console.log(`✅ Test 2 Passed: IS/OOS Split Analysis completed:`);
    console.log(`   • In-Sample Return:      ${splitResult.inSampleReturnPercent}% (Sharpe: ${splitResult.inSampleSharpe})`);
    console.log(`   • Out-of-Sample Return:  ${splitResult.outOfSampleReturnPercent}% (Sharpe: ${splitResult.outOfSampleSharpe})`);
    console.log(`   • Sharpe Retention:      ${(splitResult.sharpeRetentionRatio * 100).toFixed(1)}%`);
    console.log(`   • Overfitting Risk:      ${splitResult.overfittingRiskLevel}`);
    console.log(`   • Generalization Score:  ${splitResult.generalizationScore}/100`);

    // ------------------------------------------------------------
    // 3. Walk-Forward Analysis (WFA) Test
    // ------------------------------------------------------------
    console.log('\n3. Testing Multi-Window Walk-Forward Analysis (WFA)...');
    const wfaResult = WalkForwardEngine.runWalkForward({
        strategy,
        candleMap,
        windowsCount: 4,
        inSampleRatio: 0.70,
        options: { warmupBars: 50 },
    });

    if (wfaResult.windows.length === 0) {
        throw new Error('Test 3 Failed: No walk-forward windows generated');
    }
    console.log(`✅ Test 3 Passed: Walk-Forward Analysis completed (${wfaResult.windowsCount} windows):`);
    console.log(`   • Walk-Forward Efficiency (WFE): ${wfaResult.walkForwardEfficiency}`);
    console.log(`   • OOS Windows Profitable:        ${wfaResult.oosWinRatio}%`);
    console.log(`   • WFA Consistency Score:         ${wfaResult.consistencyScore}/100`);

    // ------------------------------------------------------------
    // 4. Monte Carlo Sequence Resampling & Ruin Analysis
    // ------------------------------------------------------------
    console.log('\n4. Testing Monte Carlo Trade Resampling (1,000 Iterations)...');
    const mcResult = MonteCarloSimulator.run(
        btResult.trades,
        10000,
        { iterations: 1000, confidencePercentile: 95 }
    );

    if (mcResult.iterations !== 1000) {
        throw new Error(`Test 4 Failed: Expected 1000 iterations, got ${mcResult.iterations}`);
    }
    console.log(`✅ Test 4 Passed: Monte Carlo 1,000 runs completed:`);
    console.log(`   • Median Return:            ${mcResult.medianReturnPercent}%`);
    console.log(`   • 5th Percentile (Worst):   ${mcResult.p5ReturnPercent}%`);
    console.log(`   • 95th Percentile (Best):   ${mcResult.p95ReturnPercent}%`);
    console.log(`   • 95% Max Drawdown:         ${mcResult.p95MaxDrawdownPercent}%`);
    console.log(`   • Probability of Ruin:      ${mcResult.probabilityOfRuinPercent}%`);
    console.log(`   • Robustness Score:         ${mcResult.robustnessScore}/100`);

    // ------------------------------------------------------------
    // 5. Market Regime Classification & Alignment
    // ------------------------------------------------------------
    console.log('\n5. Testing Market Regime Classification & Target Alignment...');
    const regimes = MarketRegimeClassifier.classify(candleMap.get('5m')!);
    const regimeAnalysis = MarketRegimeClassifier.analyze(
        strategy,
        candleMap.get('5m')!,
        btResult.trades
    );

    if (regimes.length === 0 || regimeAnalysis.regimeBreakdown.length === 0) {
        throw new Error('Test 5 Failed: Regime classification failed');
    }
    console.log(`✅ Test 5 Passed: Market Regimes classified:`);
    console.log(`   • Dominant Regime:        ${regimeAnalysis.dominantMarketRegime}`);
    console.log(`   • Regime Alignment Score: ${regimeAnalysis.regimeAlignmentScore}/100`);

    // ------------------------------------------------------------
    // 6. Full AI Robustness Scorer & Strategy Ranking
    // ------------------------------------------------------------
    console.log('\n6. Testing Full AI Strategy Ranking via AIRobustnessScorer...');
    const rankedReports = TradingBacktester.rankStrategies({
        strategies: [
            'mtf_trend_continuation',
            'mtf_supertrend_vwap',
            'mtf_failed_breakout',
        ],
        candleMap,
        options: {
            windowBars: 1000,
            warmupBars: 150,
        },
    });

    if (rankedReports.length !== 3) {
        throw new Error(`Test 6 Failed: Expected 3 ranked reports, got ${rankedReports.length}`);
    }

    console.log('\n--- 🏆 AI Strategy Ranking Board ---');
    rankedReports.forEach((r, idx) => {
        console.log(`  #${idx + 1} [Score: ${r.compositeScore.toString().padStart(3)}/100 | Verdict: ${r.verdict.padEnd(20)}] ${r.strategyName}`);
        console.log(`     OOS Consistency: ${r.scoreBreakdown.oosConsistencyScore} | Risk Quality: ${r.scoreBreakdown.riskAdjustedQualityScore} | DD Resilience: ${r.scoreBreakdown.drawdownResilienceScore}`);
    });

    console.log('\n🎉 All Part 18 Robustness & Anti-Overfitting Tests Passed Successfully!');
}

if (typeof require !== 'undefined' && require.main === module) {
    runAIRobustnessTests();
}
