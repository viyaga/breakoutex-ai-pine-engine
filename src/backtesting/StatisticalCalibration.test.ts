// ================================================================
// BreakoutEx AI — Statistical Calibration & Live Selection Tests (Part 19)
// ================================================================

import { Candle } from '../config/types';
import { TradingBacktester } from './TradingBacktester';
import { STRATEGY_LIBRARY } from '../pine/strategy-library';
import { StatisticalCalibrator } from './StatisticalCalibrator';
import { StrategyCorrelationEngine } from './StrategyCorrelationEngine';
import { MarketRegimeClassifier } from './MarketRegimeClassifier';

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

export function runStatisticalCalibrationTests(): void {
    console.log('================================================================');
    console.log('📊 BREAKOUTEX AI — STATISTICAL CALIBRATION & SELECTION TESTS');
    console.log('================================================================\n');

    const baseTimestamp = 1700000000000 - (1700000000000 % 3600000);
    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', generateCandles(12000, 5, baseTimestamp));
    candleMap.set('15m', generateCandles(4000, 15, baseTimestamp));
    candleMap.set('1h', generateCandles(1000, 60, baseTimestamp));
    candleMap.set('4h', generateCandles(500, 240, baseTimestamp));

    // ------------------------------------------------------------
    // 1. Statistical Calibrator & Wilson Score Confidence Bounds
    // ------------------------------------------------------------
    console.log('1. Testing Statistical Confidence Bounds & Uncertainty Penalties...');
    const fakeTrades = Array.from({ length: 45 }, (_, idx) => ({
        tradeNumber: idx + 1,
        side: 'long' as const,
        entryTimestamp: baseTimestamp + idx * 3600000,
        exitTimestamp: baseTimestamp + idx * 3600000 + 1800000,
        entryPrice: 50000,
        exitPrice: 50500,
        entryBarIndex: idx * 10,
        exitBarIndex: idx * 10 + 5,
        barsHeld: 5,
        grossPnlPercent: idx % 3 === 0 ? -1.5 : 2.5,
        netPnlPercent: idx % 3 === 0 ? -1.6 : 2.4,
        feePercent: 0.08,
        slippagePercent: 0.06,
        exitReason: 'tp' as const,
        maxRunUpPercent: 3.0,
        maxDrawdownPercent: 0.5,
    }));

    const calibration = StatisticalCalibrator.calibrate(fakeTrades, 66.67, 2.0, 1.8, 0.95);

    if (!calibration || calibration.winRateInterval.lower >= calibration.winRateInterval.upper) {
        throw new Error('Test 1 Failed: Invalid Wilson Score confidence interval');
    }
    console.log(`✅ Test 1 Passed: Statistical bounds calculated:`);
    console.log(`   • Sample Size:           ${calibration.tradeCount} trades (${calibration.sampleSizeClassification})`);
    console.log(`   • Win Rate 95% CI:       [${calibration.winRateInterval.lower}% — ${calibration.winRateInterval.upper}%] (±${calibration.winRateInterval.marginOfError}%)`);
    console.log(`   • Sharpe 95% CI:         [${calibration.sharpeInterval.lower} — ${calibration.sharpeInterval.upper}] (±${calibration.sharpeInterval.marginOfError})`);
    console.log(`   • Profit Factor 95% CI:  [${calibration.profitFactorInterval.lower} — ${calibration.profitFactorInterval.upper}]`);

    // ------------------------------------------------------------
    // 2. Live Market Regime Detection
    // ------------------------------------------------------------
    console.log('\n2. Testing Live Market Regime Detection...');
    const liveRegime = TradingBacktester.detectCurrentRegime(candleMap, undefined, '5m');

    if (!liveRegime || !liveRegime.currentRegime) {
        throw new Error('Test 2 Failed: Expected valid live market regime report');
    }
    console.log(`✅ Test 2 Passed: Live Market State Detected:`);
    console.log(`   • Active Regime:         ${liveRegime.currentRegime}`);
    console.log(`   • Confidence:            ${liveRegime.regimeConfidence}%`);
    console.log(`   • Trend Direction:       ${liveRegime.metrics.trendDirection}`);
    console.log(`   • ADX:                   ${liveRegime.metrics.adx}`);
    console.log(`   • ATR Ratio:             ${liveRegime.metrics.atrRatio}x`);

    // ------------------------------------------------------------
    // 3. Cross-Strategy Correlation Matrix & Redundancy Clustering
    // ------------------------------------------------------------
    console.log('\n3. Testing Cross-Strategy Correlation & Clustering...');
    const correlationReport = TradingBacktester.calculateCorrelation({
        strategies: [
            'mtf_trend_continuation',
            'mtf_trend_pullback',
            'mtf_bollinger_mean_reversion',
        ],
        candleMap,
        options: { windowBars: 2000, warmupBars: 200 },
    });

    if (!correlationReport.correlationMatrix || correlationReport.correlationMatrix.length !== 3) {
        throw new Error('Test 3 Failed: Invalid correlation matrix dimensions');
    }
    console.log(`✅ Test 3 Passed: Cross-Strategy Correlation Matrix generated:`);
    console.log(`   • Diversification Score: ${correlationReport.diversificationScore}/100`);
    console.log(`   • Avg Portfolio Corr:    ${correlationReport.averagePortfolioCorrelation}`);
    correlationReport.pairCorrelations.forEach(p => {
        console.log(`   • ${p.strategyAName} ↔ ${p.strategyBName}: r = ${p.correlation} (${p.relationship})`);
    });

    // ------------------------------------------------------------
    // 4. Live Strategy Selection & Deployment Scoring
    // ------------------------------------------------------------
    console.log('\n4. Testing Live Strategy Selection & Deployment Board...');
    const selectionReport = TradingBacktester.selectActiveStrategies({
        strategies: [
            'mtf_trend_continuation',
            'mtf_trend_pullback',
            'mtf_failed_breakout',
        ],
        candleMap,
        maxSelectedStrategies: 2,
        maxCorrelationThreshold: 0.70,
        options: { windowBars: 2500, warmupBars: 200 },
    });

    if (!selectionReport.selectedStrategies || selectionReport.selectedStrategies.length === 0) {
        throw new Error('Test 4 Failed: No active strategies selected');
    }

    console.log(`✅ Test 4 Passed: Live Strategy Selection completed:`);
    console.log(`   • Market Condition:      ${selectionReport.currentRegime} (${selectionReport.regimeConfidence}% confidence)`);
    console.log(`   • Diversification Score: ${selectionReport.portfolioDiversificationScore}/100`);
    console.log('\n--- 🚀 Active Live Deployment Recommendation ---');
    selectionReport.selectedStrategies.forEach(s => {
        console.log(`   Rank #${s.rank}: [Deploy Score: ${s.deploymentScore}/100 | Historical: ${s.historicalRobustnessScore}/100 | Regime Fit: ${s.currentRegimeFitScore}/100] ${s.strategyName}`);
        console.log(`            Recommendation: ${s.recommendation}`);
    });

    console.log('\n🎉 All Part 19 Statistical Calibration & Selection Tests Passed Successfully!');
}

if (typeof require !== 'undefined' && require.main === module) {
    runStatisticalCalibrationTests();
}
