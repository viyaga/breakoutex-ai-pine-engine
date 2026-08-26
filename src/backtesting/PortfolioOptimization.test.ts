// ================================================================
// BreakoutEx AI — Portfolio Optimization & Meta-Strategy Tests (Part 20)
// ================================================================

import { Candle } from '../config/types';
import { TradingBacktester } from './TradingBacktester';
import { RiskExecutionGate } from './RiskExecutionGate';
import { PortfolioOptimizer } from './PortfolioOptimizer';
import { MetaStrategyValidator } from './MetaStrategyValidator';
import { STRATEGY_LIBRARY } from './strategy-library';

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

export function runPortfolioOptimizationTests(): void {
    console.log('================================================================');
    console.log('💼 BREAKOUTEX AI — PORTFOLIO & META-STRATEGY OOS TESTS (PART 20)');
    console.log('================================================================\n');

    const baseTimestamp = 1700000000000 - (1700000000000 % 3600000);
    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', generateCandles(30000, 5, baseTimestamp));
    candleMap.set('15m', generateCandles(10000, 15, baseTimestamp));
    candleMap.set('1h', generateCandles(2500, 60, baseTimestamp));
    candleMap.set('4h', generateCandles(1200, 240, baseTimestamp));

    // ------------------------------------------------------------
    // 1. Testing Risk Execution Gate & Position Sizing Limits
    // ------------------------------------------------------------
    console.log('1. Testing Risk & Execution Gate Rules...');

    // Scenario A: Valid trade within budget
    const validDecision = TradingBacktester.evaluateRiskGate({
        strategyId: 'mtf_trend_continuation',
        strategyName: 'MTF Trend Continuation',
        symbol: 'BTCUSDT',
        side: 'long',
        entryPrice: 50000,
        stopLossPrice: 49000, // 2% risk
        takeProfitPrice: 53000, // 6% reward (RR = 3.0)
        currentAccountEquity: 10000,
        peakDailyAccountEquity: 10000,
        currentOpenPositionsCount: 1,
    }, {
        totalAccountCapital: 10000,
        maxRiskPerTradePercent: 2.0, // $200 risk
        maxTotalOpenPositions: 4,
        maxDailyDrawdownLimitPercent: 5.0,
    });

    if (!validDecision.permitted || validDecision.riskAmountCapital > 200.01) {
        throw new Error(`Test 1A Failed: Expected permitted trade with <= $200 risk, got $${validDecision.riskAmountCapital}`);
    }
    console.log(`✅ Test 1A Passed: Valid trade approved:`);
    console.log(`   • Status:            ${validDecision.riskStatus}`);
    console.log(`   • Position Capital:  $${validDecision.positionCapital} (${validDecision.riskPercent}% equity risk)`);
    console.log(`   • Risk/Reward Ratio: ${validDecision.riskRewardRatio}`);

    // Scenario B: Daily Drawdown Circuit Breaker Breached
    const ddBreachedDecision = TradingBacktester.evaluateRiskGate({
        strategyId: 'mtf_trend_continuation',
        strategyName: 'MTF Trend Continuation',
        symbol: 'BTCUSDT',
        side: 'long',
        entryPrice: 50000,
        stopLossPrice: 49000,
        takeProfitPrice: 52000,
        currentAccountEquity: 9400, // 6% drop from peak
        peakDailyAccountEquity: 10000,
        currentOpenPositionsCount: 0,
    }, {
        totalAccountCapital: 10000,
        maxDailyDrawdownLimitPercent: 5.0,
    });

    if (ddBreachedDecision.permitted || ddBreachedDecision.riskStatus !== 'REJECTED_DRAWDOWN_LIMIT') {
        throw new Error('Test 1B Failed: Expected rejection due to daily drawdown breaker');
    }
    console.log(`✅ Test 1B Passed: Daily drawdown breaker halted execution (${ddBreachedDecision.rejectionReason})`);

    // ------------------------------------------------------------
    // 2. Testing Multi-Strategy Portfolio Construction
    // ------------------------------------------------------------
    console.log('\n2. Testing Multi-Strategy Portfolio Construction & Synchronized Drawdown...');

    const portfolioReport = TradingBacktester.constructPortfolio({
        strategies: [
            'mtf_trend_continuation',
            'mtf_trend_pullback',
            'mtf_failed_breakout',
        ],
        candleMap,
        allocationModel: 'CLUSTER_BALANCED',
        totalCapital: 10000,
        cashReservePercent: 10,
        maxWeightPerStrategyPercent: 40,
        options: { windowBars: 3000, warmupBars: 200 },
    });

    if (!portfolioReport || portfolioReport.strategyAllocations.length === 0) {
        throw new Error('Test 2 Failed: Portfolio allocation failed');
    }

    console.log(`✅ Test 2 Passed: Portfolio optimized:`);
    console.log(`   • Allocation Model:        ${portfolioReport.allocationModel}`);
    console.log(`   • Total Capital:           $${portfolioReport.totalCapital}`);
    console.log(`   • Cash Reserve:            ${portfolioReport.cashReservePercent}% ($${portfolioReport.cashReserveAmount})`);
    console.log(`   • Portfolio Return:        ${portfolioReport.portfolioReturnPercent}%`);
    console.log(`   • Portfolio Max Drawdown:  ${portfolioReport.portfolioMaxDrawdownPercent}%`);
    console.log(`   • Component Weighted DD:   ${portfolioReport.weightedComponentDrawdownPercent}%`);
    console.log(`   • Diversification Benefit: ${portfolioReport.diversificationBenefitPercent}% DD reduction`);

    portfolioReport.strategyAllocations.forEach(a => {
        console.log(`     - [${a.strategyName}]: ${a.weightPercent}% weight ($${a.allocatedCapital}) | Risk Budget: ${a.riskBudgetPercent}%`);
    });

    // ------------------------------------------------------------
    // 3. Testing Level-2 Meta-Strategy Out-of-Sample (OOS) Validation
    // ------------------------------------------------------------
    console.log('\n3. Testing Level-2 Meta-Strategy Out-of-Sample (OOS) Validator...');

    const metaReport = TradingBacktester.validateMetaStrategy({
        strategies: [
            'mtf_trend_continuation',
            'mtf_supertrend_vwap',
            'mtf_failed_breakout',
        ],
        candleMap,
        selectionRatio: 0.70, // 70% T1 Selection, 30% T2 Realization
        maxSelectedStrategies: 2,
        allocationModel: 'CLUSTER_BALANCED',
        options: { windowBars: 4000, warmupBars: 200 },
    });

    if (!metaReport || !metaReport.selectedPortfolioAllocations.length) {
        throw new Error('Test 3 Failed: Meta-Strategy validation failed');
    }

    console.log(`✅ Test 3 Passed: Level-2 Meta-Strategy OOS Validation completed:`);
    console.log(`   • Selection Phase (T1):     ${metaReport.selectionPhaseBars} bars`);
    console.log(`   • Realization Phase (T2):   ${metaReport.realizationPhaseBars} bars (Untouched Forward Test)`);
    console.log(`   • In-Sample Sharpe (T1):    ${metaReport.inSamplePredictedSharpe}`);
    console.log(`   • Realized OOS Sharpe (T2): ${metaReport.realizedOutOfSampleSharpe}`);
    console.log(`   • Single Best Strat Sharpe: ${metaReport.singleBestStrategyOosSharpe}`);
    console.log(`   • Equal Weight OOS Sharpe:  ${metaReport.equalWeightBenchmarkOosSharpe}`);
    console.log(`   • Meta Selection Efficiency:${metaReport.metaSelectionEfficiency}`);
    console.log(`   • Generalization Rating:    ${metaReport.metaGeneralizationRating}`);

    console.log('\n🎉 All Part 20 Portfolio Construction & Meta-Strategy Tests Passed Successfully!');
}

if (typeof require !== 'undefined' && require.main === module) {
    runPortfolioOptimizationTests();
}
