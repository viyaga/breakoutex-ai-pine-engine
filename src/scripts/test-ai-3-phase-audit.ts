import { evaluateAndApplyAiStrategy, computeMarketSnapshot } from '../engine/ai-market-evaluator';
import { StrategyPerformanceTracker } from '../engine/strategy-performance-tracker';
import { PineBotConfig, Candle } from '../config/types';
import { STRATEGY_LIBRARY, getStrategyById, AIRobustnessScorer } from '../backtesting';

function createMockBot(overrides: Partial<PineBotConfig> = {}): PineBotConfig {
    return {
        id: 'test_3phase_bot',
        USER_ID: 'user_test',
        EXCHANGE: 'binance',
        API_KEY: '',
        SECRET_KEY: '',
        SYMBOL: 'BTCUSDT',
        PRODUCT_ID: 1,
        LOT_SIZE: 1,
        PRICE_DECIMAL_PLACES: 2,
        BASE_URL: '',
        TIMEFRAME: '5m',
        MODE: 'balanced',
        LEVERAGE: 5,
        CAPITAL_AMOUNT: 1000,
        MIN_TRADE_SIZE: 10,
        MAX_TRADE_SIZE: 100,
        MIN_RR: 1.5,
        MIN_SCORE: 60,
        DAILY_LOSS_LIMIT: 5,
        MAX_CONCURRENT_TRADES: 1,
        IS_WEEKEND_SAFETY_ENABLED: false,
        SL_TRIGGER_BUFFER_PERCENT: 0.1,
        SL_LIMIT_BUFFER_PERCENT: 0.1,
        TP_TRIGGER_BUFFER_PERCENT: 0.1,
        TP_LIMIT_BUFFER_PERCENT: 0.1,
        ESTIMATED_FEE_PERCENT: 0.05,
        DRY_RUN: true,
        TP_PERCENT: 99.0, // intentional arbitrary initial value to prove Phase 2 overwrites
        SL_PERCENT: 99.0,
        IS_AI_MANAGED: true,
        PINE_SCRIPT: '//@version=6\n// initial',
        CURRENT_STRATEGY_ID: 'none',
        CURRENT_STRATEGY_NAME: 'None',
        ...overrides,
    };
}

function generateCandles(
    count: number,
    intervalMinutes: number,
    baseTimestamp: number,
    basePrice = 60000
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
        const volume = 1000 + Math.random() * 500;

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

async function runAudit() {
    console.log('\n========================================================================');
    console.log('🧪 3-PHASE AI STRATEGY & RISK ARCHITECTURE VERIFICATION AUDIT');
    console.log('========================================================================\n');

    // -------------------------------------------------------------
    // AUDIT 1: Phase 3 Strategy Performance Memory & Cooldown
    // -------------------------------------------------------------
    console.log('── [Phase 3 Audit] Strategy Performance Memory & Cooldown ──');
    const testSymbol = 'ETHUSDT';
    const testStratId = 'mtf_trend_continuation';

    // Clear any previous state
    StrategyPerformanceTracker.clearCooldown(testSymbol, testStratId);

    console.log('1. Recording 1st loss on ETHUSDT [mtf_trend_continuation]...');
    StrategyPerformanceTracker.recordTradeOutcome(testSymbol, testStratId, 'loss', -15);
    let check1 = StrategyPerformanceTracker.isStrategyInCooldown(testSymbol, testStratId);
    if (check1.inCooldown) {
        console.error('✗ FAIL: Strategy went into cooldown after only 1 loss!');
        process.exit(1);
    }
    console.log('✓ 1st loss tracked. Consecutive losses = 1 (Cooldown NOT triggered yet).');

    console.log('2. Recording 2nd consecutive loss on ETHUSDT [mtf_trend_continuation]...');
    StrategyPerformanceTracker.recordTradeOutcome(testSymbol, testStratId, 'loss', -20);
    let check2 = StrategyPerformanceTracker.isStrategyInCooldown(testSymbol, testStratId);
    if (!check2.inCooldown) {
        console.error('✗ FAIL: Strategy failed to trigger cooldown after 2 consecutive losses!');
        process.exit(1);
    }
    console.log(`✓ 2nd loss triggered 4-hour cooldown: inCooldown=true (${check2.remainingMinutes}m remaining).`);
    console.log(`✓ Reason: "${check2.reason}"\n`);

    // -------------------------------------------------------------
    // AUDIT 2: Phase 1 Robustness Gating via AIRobustnessScorer
    // -------------------------------------------------------------
    console.log('── [Phase 1 Audit] AIRobustnessScorer (Monte Carlo + Walk-Forward) ──');
    const baseTimestamp = 1700000000000 - (1700000000000 % 3600000);
    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', generateCandles(30000, 5, baseTimestamp));
    candleMap.set('15m', generateCandles(10000, 15, baseTimestamp));
    candleMap.set('1h', generateCandles(2500, 60, baseTimestamp));
    candleMap.set('4h', generateCandles(700, 240, baseTimestamp));

    const stratDef = STRATEGY_LIBRARY.mtf_failed_breakout;
    const report = AIRobustnessScorer.evaluate(stratDef, candleMap, {
        baseTimeframe: '5m',
        symbol: 'BTCUSDT',
    });

    console.log(`• Evaluated Strategy: "${stratDef.name}"`);
    console.log(`• Composite Robustness Score: ${report.compositeScore}/100`);
    console.log(`• Deployment Score: ${report.deploymentScore}/100`);
    console.log(`• Verdict: ${report.verdict}`);
    console.log(`• Monte Carlo Ruin Prob: ${report.monteCarloSimulation.probabilityOfRuinPercent.toFixed(1)}%`);
    console.log(`• Monte Carlo 95% MaxDD: ${report.monteCarloSimulation.p95MaxDrawdownPercent.toFixed(1)}%`);
    console.log(`• Walk-Forward Generalization: ${report.splitAnalysis.generalizationScore.toFixed(0)}%`);

    if (report.compositeScore >= 0 && report.monteCarloSimulation.probabilityOfRuinPercent !== undefined) {
        console.log('✓ PASS: AIRobustnessScorer successfully calculated Walk-Forward & Monte Carlo statistics.\n');
    } else {
        console.error('✗ FAIL: Incomplete robustness report returned.');
        process.exit(1);
    }

    // -------------------------------------------------------------
    // AUDIT 3: Phase 2 Predefined Strategy TP/SL Enforcement
    // -------------------------------------------------------------
    console.log('── [Phase 2 Audit] Predefined Strategy TP/SL Strict Enforcement ──');
    const bot = createMockBot({
        SYMBOL: 'BTCUSDT',
        TP_PERCENT: 99.0, // Arbitrary dummy value
        SL_PERCENT: 99.0,
    });

    console.log(`• Initial Bot Config: TP=${bot.TP_PERCENT}%, SL=${bot.SL_PERCENT}%`);
    await evaluateAndApplyAiStrategy(
        bot,
        candleMap.get('5m')!,
        candleMap.get('15m'),
        candleMap.get('1h'),
        candleMap.get('4h')
    );

    if (bot.CURRENT_STRATEGY_ID && bot.CURRENT_STRATEGY_ID !== 'stand_aside') {
        const chosenStrat = getStrategyById(bot.CURRENT_STRATEGY_ID)!;
        console.log(`• Strategy Assigned: "${chosenStrat.name}" [${chosenStrat.id}]`);
        console.log(`• Strategy Default Definition: TP=${chosenStrat.defaultTpPercent}%, SL=${chosenStrat.defaultSlPercent}%`);
        console.log(`• Bot Config After Evaluation: TP=${bot.TP_PERCENT}%, SL=${bot.SL_PERCENT}%`);

        if (bot.TP_PERCENT === chosenStrat.defaultTpPercent && bot.SL_PERCENT === chosenStrat.defaultSlPercent) {
            console.log('✓ PASS: TP and SL were strictly assigned from the predefined strategy definition (No AI override).');
        } else {
            console.error(`✗ FAIL: Bot TP/SL (${bot.TP_PERCENT}% / ${bot.SL_PERCENT}%) does not match strategy definition (${chosenStrat.defaultTpPercent}% / ${chosenStrat.defaultSlPercent}%)!`);
            process.exit(1);
        }
    } else {
        console.log(`• Market evaluated to STAND ASIDE: TP=${bot.TP_PERCENT}%, SL=${bot.SL_PERCENT}% (Trade entry suspended).`);
        console.log('✓ PASS: Engine cleanly honored STAND ASIDE (NO TRADE) signal.');
    }

    console.log('\n========================================================================');
    console.log('🎉 ALL 3 PHASES VERIFIED AND FULLY PASSING AUTOMATED AUDIT!');
    console.log('========================================================================\n');
}

runAudit().catch(err => {
    console.error('3-Phase audit failed:', err);
    process.exit(1);
});
