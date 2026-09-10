import { evaluateAndApplyAiStrategy, computeMarketSnapshot } from '../engine/ai-market-evaluator';
import { PineBotConfig, Candle } from '../config/types';
import { STRATEGY_LIBRARY } from '../backtesting';

function createMockBot(overrides: Partial<PineBotConfig> = {}): PineBotConfig {
    return {
        id: 'test_bot_ai_strict',
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
        TP_PERCENT: 2.5,
        SL_PERCENT: 1.0,
        IS_AI_MANAGED: true,
        PINE_SCRIPT: '//@version=6\n// old script',
        CURRENT_STRATEGY_ID: 'mtf_trend_continuation',
        CURRENT_STRATEGY_NAME: 'MTF Trend Continuation',
        ...overrides,
    };
}

function generateCandles(count: number, basePrice: number, volatility = 0.001): Candle[] {
    const candles: Candle[] = [];
    let price = basePrice;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        const change = (Math.sin(i / 10)) * (price * volatility);
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + price * 0.0005;
        const low = Math.min(open, close) - price * 0.0005;
        const volume = 1000;
        price = close;
        candles.push({
            timestamp: now - (count - i) * 300000,
            open,
            high,
            low,
            close,
            volume,
        });
    }
    return candles;
}

async function runAudit() {
    console.log('\n============================================================');
    console.log('🧪 Testing Strict AI Strategy Selection & NO_TRADE Protocol');
    console.log('============================================================\n');

    // Test 1: Predefined Strategy Catalog Integrity
    console.log('[Test 1] Predefined Strategy Catalog Integrity...');
    const predefinedIds = Object.keys(STRATEGY_LIBRARY);
    console.log(`Predefined catalog count: ${predefinedIds.length} strategies`);
    if (predefinedIds.length < 12) {
        console.error('✗ FAIL: Predefined library missing expected strategies');
        process.exit(1);
    }
    console.log('✓ PASS: Predefined library contains all 12 strategy families\n');

    // Test 2: Live AI Evaluation with Gemini
    console.log('[Test 2] Live Market AI Selection...');
    const candles = generateCandles(150, 60000, 0.0005);
    const bot = createMockBot({ id: 'live_test_bot' });
    await evaluateAndApplyAiStrategy(bot, candles);

    const isPredefined = bot.CURRENT_STRATEGY_ID ? predefinedIds.includes(bot.CURRENT_STRATEGY_ID) : false;
    const isStandAside = bot.CURRENT_STRATEGY_ID === 'stand_aside';

    console.log(`Live AI Selection Result: strategyId="${bot.CURRENT_STRATEGY_ID}", standAside=${isStandAside}`);

    if (isStandAside) {
        if (bot.PINE_SCRIPT === '') {
            console.log('✓ PASS: AI selected STAND ASIDE and PINE_SCRIPT was cleanly cleared (No Trade Signal).');
        } else {
            console.error('✗ FAIL: AI stood aside but PINE_SCRIPT was not empty!');
            process.exit(1);
        }
    } else if (isPredefined) {
        if (bot.PINE_SCRIPT.length > 50) {
            console.log(`✓ PASS: AI picked strictly one valid predefined strategy: "${bot.CURRENT_STRATEGY_NAME}" [${bot.CURRENT_STRATEGY_ID}].`);
        } else {
            console.error('✗ FAIL: Selected strategy had empty pine script!');
            process.exit(1);
        }
    } else {
        console.error(`✗ FAIL: Strategy ID "${bot.CURRENT_STRATEGY_ID}" is neither in the predefined catalog nor stand_aside!`);
        process.exit(1);
    }

    console.log('\n============================================================');
    console.log('✓ All strict AI strategy selection verification checks PASSED!');
    console.log('============================================================\n');
}

runAudit().catch(err => {
    console.error('Audit failed with error:', err);
    process.exit(1);
});
