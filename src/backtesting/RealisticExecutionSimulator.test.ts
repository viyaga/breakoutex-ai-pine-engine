// ================================================================
// BreakoutEx AI — Realistic Execution Simulator Tests (Part 21)
// ================================================================

import { Candle } from '../config/types';
import { TradingBacktester } from './TradingBacktester';
import { ExchangeConfig, PRESET_EXCHANGES } from './ExchangeConfig';
import { ExecutionSimulator } from './ExecutionSimulator';

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

export function runRealisticExecutionSimulatorTests(): void {
    console.log('================================================================');
    console.log('⚡ BREAKOUTEX AI — REALISTIC EXECUTION SIMULATOR TESTS (PART 21)');
    console.log('================================================================\n');

    const baseTimestamp = 1700000000000 - (1700000000000 % 3600000);
    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', generateCandles(10000, 5, baseTimestamp));
    candleMap.set('15m', generateCandles(3500, 15, baseTimestamp));
    candleMap.set('1h', generateCandles(900, 60, baseTimestamp));
    candleMap.set('4h', generateCandles(400, 240, baseTimestamp));

    // ------------------------------------------------------------
    // 1. Testing Exchange Presets & Precision Mechanics
    // ------------------------------------------------------------
    console.log('1. Testing Exchange Specs, Tick Size & Quantity Rounding...');
    const binanceBtc = ExchangeConfig.getSpec('BINANCE_FUTURES_BTC');

    const roundedPrice = ExecutionSimulator.roundPriceToTick(50123.4567, binanceBtc.tickSize);
    const roundedQty = ExecutionSimulator.roundQtyToStep(0.1234567, binanceBtc.stepSize, binanceBtc.minQty);

    if (roundedPrice !== 50123.5 || roundedQty !== 0.123) {
        throw new Error(`Test 1 Failed: Rounding error (Price: ${roundedPrice}, Qty: ${roundedQty})`);
    }

    console.log(`✅ Test 1 Passed: Precision rounding verified:`);
    console.log(`   • Exchange:          ${binanceBtc.name}`);
    console.log(`   • Price (tick 0.1):  50123.4567 -> ${roundedPrice}`);
    console.log(`   • Qty (step 0.001): 0.1234567 -> ${roundedQty}`);

    // ------------------------------------------------------------
    // 2. Testing Market / Limit / Stop-Loss Gap Fills
    // ------------------------------------------------------------
    console.log('\n2. Testing Realistic Fill Simulation (Spread, Volatility Slippage, SL Gap)...');

    const sampleCandle: Candle = {
        timestamp: baseTimestamp,
        open: 50000,
        high: 51000,
        low: 48500,
        close: 49500,
        volume: 2500,
    };

    // Scenario A: Market Buy Order
    const marketFill = ExecutionSimulator.executeOrder({
        orderType: 'MARKET',
        side: 'long',
        requestedPrice: 50000,
        requestedQuantity: 0.1,
        candle: sampleCandle,
        atrRatio: 1.5,
    }, binanceBtc);

    if (marketFill.executedPrice <= 50000 || marketFill.feeType !== 'TAKER') {
        throw new Error('Test 2A Failed: Expected market buy fill price above 50,000 with taker fee');
    }
    console.log(`✅ Test 2A Passed: Market Entry Fill calculated:`);
    console.log(`   • Requested: $50,000 -> Executed: $${marketFill.executedPrice} (Spread/Slippage: $${marketFill.slippagePaid})`);
    console.log(`   • Fee:       $${marketFill.feePaid} (${marketFill.feeType})`);

    // Scenario B: Limit Take Profit Sell Order
    const limitFill = ExecutionSimulator.executeOrder({
        orderType: 'LIMIT',
        side: 'short',
        requestedPrice: 52000,
        requestedQuantity: 0.1,
        candle: sampleCandle,
        isExit: true,
    }, binanceBtc);

    if (limitFill.feeType !== 'MAKER') {
        throw new Error('Test 2B Failed: Expected limit order fill with maker fee');
    }
    console.log(`✅ Test 2B Passed: Limit TP Fill calculated:`);
    console.log(`   • Executed:  $${limitFill.executedPrice} | Fee: $${limitFill.feePaid} (${limitFill.feeType})`);

    // Scenario C: Gap-through Stop Loss Fill
    const slFill = ExecutionSimulator.executeOrder({
        orderType: 'STOP_MARKET',
        side: 'long',
        requestedPrice: 49000,
        requestedQuantity: 0.1,
        candle: { ...sampleCandle, open: 48200 }, // Gap open below SL
        isStopLoss: true,
    }, binanceBtc);

    if (slFill.executedPrice > 48200) {
        throw new Error('Test 2C Failed: Expected gap execution at or below 48,200');
    }
    console.log(`✅ Test 2C Passed: Gap Stop Loss Fill calculated:`);
    console.log(`   • SL Trigger: $49,000 -> Gap Fill: $${slFill.executedPrice} (Gap Loss: $${slFill.gapLossPaid})`);

    // ------------------------------------------------------------
    // 3. Testing Perpetual Funding Costs & Liquidation Check
    // ------------------------------------------------------------
    console.log('\n3. Testing Perpetual Funding & Liquidation Engine...');
    const fundingCost = ExecutionSimulator.calculateFundingCost(5000, 'long', 1440, 0.01); // 24 hours held
    const liqCheck = ExecutionSimulator.checkLiquidation(50000, 'long', 20, 0.5, 51000, 47000);

    if (fundingCost <= 0 || !liqCheck.isLiquidated) {
        throw new Error('Test 3 Failed: Funding or Liquidation check failed');
    }
    console.log(`✅ Test 3 Passed: Perpetual Funding & Liquidation verified:`);
    console.log(`   • 24h Funding Cost for $5,000 Long: $${fundingCost}`);
    console.log(`   • Liquidation Price for 20x Long @ $50,000: $${liqCheck.liquidationPrice} (Breached: ${liqCheck.isLiquidated})`);

    // ------------------------------------------------------------
    // 4. Testing Dual-Execution Comparison (Ideal vs Realistic)
    // ------------------------------------------------------------
    console.log('\n4. Testing Dual Execution Comparison (Ideal vs Realistic Microstructure)...');

    const comparisonReport = TradingBacktester.simulateRealisticExecution({
        strategy: 'mtf_trend_continuation',
        candleMap,
        exchange: 'BINANCE_FUTURES_BTC',
        options: { windowBars: 3000, warmupBars: 200 },
    });

    if (!comparisonReport || !comparisonReport.frictionCostBreakdown) {
        throw new Error('Test 4 Failed: Execution comparison failed');
    }

    console.log(`✅ Test 4 Passed: Dual Execution Comparison report generated:`);
    console.log(`   • Exchange Profile:          ${comparisonReport.exchangeName}`);
    console.log(`   • Ideal Return (Frictionless):${comparisonReport.idealResult.totalReturnPercent?.toFixed(2)}%`);
    console.log(`   • Realistic Net Return:      ${comparisonReport.realisticResult.totalReturnPercent?.toFixed(2)}%`);
    console.log(`   • Return Degradation:        ${comparisonReport.netReturnDegradationPercent}%`);
    console.log(`   • Edge Retention Ratio:      ${(comparisonReport.edgeRetentionRatio * 100).toFixed(1)}%`);
    console.log(`   • Friction Verdict:          ${comparisonReport.verdict}`);
    console.log('\n--- 💸 Friction Cost Breakdown ---');
    console.log(`   • Maker Fees:   $${comparisonReport.frictionCostBreakdown.totalMakerFees}`);
    console.log(`   • Taker Fees:   $${comparisonReport.frictionCostBreakdown.totalTakerFees}`);
    console.log(`   • Slippage:     $${comparisonReport.frictionCostBreakdown.totalSlippageCost}`);
    console.log(`   • Spread:       $${comparisonReport.frictionCostBreakdown.totalSpreadCost}`);
    console.log(`   • Total Friction: $${comparisonReport.frictionCostBreakdown.totalFrictionDollars} (${comparisonReport.frictionCostBreakdown.totalFrictionPercent}% of capital)`);

    console.log('\n🎉 All Part 21 Realistic Execution Simulator Tests Passed Successfully!');
}

if (typeof require !== 'undefined' && require.main === module) {
    runRealisticExecutionSimulatorTests();
}
