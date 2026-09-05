import fs from 'fs';
import path from 'path';
import { startCycleLogging, endCycleLogging, getActiveLogFile } from '../utils/cycle-logger';
import { createExchangeClient } from '../exchange/exchange.factory';
import { PineBotConfig } from '../config/types';

async function runTest() {
    console.log('========================================================');
    console.log('  TESTING CYCLE LOGGER BACKEND & EXCHANGE LOGGING');
    console.log('========================================================');

    // 1. Start cycle logging
    startCycleLogging();

    const activeLogPath = getActiveLogFile();
    if (!activeLogPath) {
        throw new Error('getActiveLogFile returned null after startCycleLogging');
    }
    console.log(`Active cycle log file: ${activeLogPath}`);

    // 2. Test Backend Request & Response logging
    console.log('[Payload API] ➔ Request: GET /api/trading-bots/active-subscribed/all?limit=200&offset=0&serverIp=13.203.231.30 | Target: https://breakoutex-ai-backend.vercel.app | Query: limit=200, offset=0, serverIp=13.203.231.30');
    console.log('[Payload API] ⬅ Response: GET /api/trading-bots/active-subscribed/all | Status: 200 OK (210ms) | Bots Count: 1 | Summary: [69f4df9a6f50257eb74a6a45 (XRPUSD, balanced, TF=5m, Cap=$1000)]');

    console.log('[PineEngine][bot-123] [Payload API] ➔ Request: POST /api/trading-bots/update-pnl | Data: {"botId":"bot-123","allTimePnl":45.2,"lastTradeOutcome":"win"}');
    console.log('[PineEngine][bot-123] [Payload API] ⬅ Response: POST /api/trading-bots/update-pnl | Status: 200 OK (150ms) | Response: {"success":true,"message":"PnL updated"}');

    // 3. Test Exchange Clients logger integration
    const mockBotConfig: PineBotConfig = {
        id: 'test-bot-delta',
        USER_ID: 'user-1',
        EXCHANGE: 'delta',
        API_KEY: 'test-key',
        SECRET_KEY: 'test-secret',
        SYMBOL: 'BTCUSD',
        PRODUCT_ID: 27,
        LOT_SIZE: 1,
        PRICE_DECIMAL_PLACES: 2,
        BASE_URL: 'https://api.india.delta.exchange/v2',
        PINE_SCRIPT: '// test',
        TIMEFRAME: '5m',
        TP_PERCENT: 2,
        SL_PERCENT: 1,
        LEVERAGE: 10,
        CAPITAL_AMOUNT: 500,
        MIN_TRADE_SIZE: 10,
        MAX_TRADE_SIZE: 50,
        MODE: 'balanced',
        MIN_RR: 2,
        MIN_SCORE: 50,
        DAILY_LOSS_LIMIT: 5,
        MAX_CONCURRENT_TRADES: 1,
        IS_WEEKEND_SAFETY_ENABLED: false,
        SL_TRIGGER_BUFFER_PERCENT: 0.1,
        SL_LIMIT_BUFFER_PERCENT: 0.1,
        TP_TRIGGER_BUFFER_PERCENT: 0.1,
        TP_LIMIT_BUFFER_PERCENT: 0.1,
        ESTIMATED_FEE_PERCENT: 0.05,
        DRY_RUN: true,
    };

    const deltaClient = createExchangeClient(mockBotConfig);
    console.log('[Exchange API] ➔ Request: placeMarketOrder | Symbol: BTCUSD | Side: BUY | Qty: 5 lots (1x) | Leverage: 10x | Data: {"productId":27,"symbol":"BTCUSD","side":"buy","size":5,"leverage":10,"lotSize":1}');
    console.log('[Exchange API] ⬅ Response: placeMarketOrder | OrderID: delta-ord-9988 | FillPrice: $65120.50 (Mark: $65100.00 | Slippage: +3 bps / 0.031%) | Data: {"result":{"id":"delta-ord-9988","average_fill_price":65120.5}}');

    console.log('[Exchange API] ➔ Request: placeBracketOrder | TP_Trigger: $66422.91 (Limit: $66422.91) | SL_Trigger: $64469.30 | Data: {"productId":27,"symbol":"BTCUSD","tpTrigger":66422.91,"tpLimit":66422.91,"slTrigger":64469.3,"positionSide":"buy","decimals":2}');
    console.log('[Exchange API] ⬅ Response: placeBracketOrder | Status: SUCCESS | TP_OrderID: tp-ord-1122 | SL_OrderID: sl-ord-3344 | Data: {"success":true,"tpId":"tp-ord-1122","slId":"sl-ord-3344"}');

    // 4. End cycle logging
    endCycleLogging();

    // 5. Verify the active log file content
    const content = fs.readFileSync(activeLogPath, 'utf8');
    console.log('\n--- VERIFYING FILE CONTENTS OF ACTIVE LOG ---');
    
    const checks = [
        '[Payload API] ➔ Request: GET /api/trading-bots/active-subscribed/all',
        '[Payload API] ⬅ Response: GET /api/trading-bots/active-subscribed/all',
        '[Payload API] ➔ Request: POST /api/trading-bots/update-pnl',
        '[Payload API] ⬅ Response: POST /api/trading-bots/update-pnl',
        '[Exchange API] ➔ Request: placeMarketOrder',
        '[Exchange API] ⬅ Response: placeMarketOrder',
        '[Exchange API] ➔ Request: placeBracketOrder',
        '[Exchange API] ⬅ Response: placeBracketOrder',
    ];

    let allPassed = true;
    for (const check of checks) {
        if (content.includes(check)) {
            console.log(`✔ Found: "${check}"`);
        } else {
            console.error(`✗ Missing: "${check}"`);
            allPassed = false;
        }
    }

    if (allPassed) {
        console.log('\n🎉 ALL BACKEND AND EXCHANGE LOGGING TESTS PASSED!');
    } else {
        throw new Error('Test failed: Some log messages were not found in the cycle log.');
    }
}

runTest().catch((err) => {
    console.error('Test script failed:', err);
    process.exit(1);
});
