import fs from 'fs';
import {
    startCycleLogging,
    endCycleLogging,
    getActiveLogFile,
    tradingCronLogger,
    tradingCycleLogger,
    marketDataLogger,
    positionManagerLogger
} from '../utils/cycle-logger';

async function testPonrajCycleLogging() {
    console.log('--- Starting Ponraj Cycle Logging Test ---');

    startCycleLogging();
    const activeFile = getActiveLogFile();
    if (!activeFile) {
        throw new Error('Active log file was not created');
    }

    const cycleStart = Date.now();
    const mockBotId = '69f4df9a6f50257eb74a6a45';
    const mockSymbol = 'XRPUSD';
    const cycleId = `cycle-${Date.now()}-b582x`;
    const context = { cycleId, symbol: mockSymbol, tradingBotId: mockBotId };

    // 1. Cycle start banner
    tradingCronLogger.info('='.repeat(80));
    tradingCronLogger.info('[TradingCron] ========== CYCLE START ==========');
    tradingCronLogger.info('='.repeat(80));
    tradingCronLogger.debug('[TradingV2] Market data caches cleared');

    // 2. Fetch configs
    tradingCronLogger.info('[TradingCron] Fetching trading configs with LIMIT=100, starting at offset=0...');
    tradingCronLogger.info('[TradingCron] Fetched 1 configs at offset=0');
    tradingCronLogger.info('[TradingCron] Processing batch of 1 configs with CONCURRENCY=2...');
    tradingCronLogger.info(`[TradingCron] Starting cycle for config: ${mockBotId} (${mockSymbol})`);

    // 3. Bot execution block
    tradingCycleLogger.info(`[TradingCycle] ========== START PROCESSING BOT: ${mockSymbol} (ID: ${mockBotId}) ==========`, context);
    tradingCycleLogger.info(`[Config] Bot Configuration: Mode=balanced | Capital=$100 | Leverage=40x | TF=5m | AI_Managed=true | MinScore=50`, context);
    tradingCycleLogger.info(`[LeverageSync] Checking leverage for product 14969...`, context);
    tradingCycleLogger.info(`[LeverageSync] Current leverage on Delta: 40, Configured leverage: 40`, context);
    tradingCycleLogger.info(`[LeverageSync] Leverage is already set correctly to 40`, context);

    // 4. Candlestick block
    const candlestickMsg = `[MarketData] Candlestick Data Fetched:\n` +
        `          ENTRY (5m): 80 candles, Target: [O:1.1068, H:1.1079, L:1.1068, C:1.1074, Color:green]\n` +
        `          CONFIRMATION (15m): 80 candles, Target: [O:1.1074, H:1.1079, L:1.1067, C:1.1074, Color:green]\n` +
        `          STRUCTURE (1h): 80 candles, Target: [O:1.1093, H:1.1107, L:1.1027, C:1.1084, Color:red]`;
    marketDataLogger.info(candlestickMsg, context);

    // 5. Mark price
    marketDataLogger.debug(`[MarketPrice] Fetching latest price for ${mockSymbol}...`, context);
    marketDataLogger.info(`[MarketPrice] Current Mark Price: 1.10745762`, context);

    // 6. State & Position Management
    tradingCycleLogger.info(`[State] Loaded state: ID=${mockBotId}, Outcome=pending, Status=open, DailyPnL=$0.00, Cooldown=None`, context);
    positionManagerLogger.info(`[PositionManager] Position is active. Managing existing position. No new entries allowed.`, context);

    // 7. Bot finish
    tradingCycleLogger.info(`[TradingCycle] ========== END PROCESSING BOT: ${mockSymbol} (ID: ${mockBotId}) ========== (Duration: 245ms)`, context);
    tradingCronLogger.info(`[TradingCron] ✓ Config ${mockBotId} (${mockSymbol}) completed successfully (Duration: 245ms)`);

    // 8. Cycle completion banner
    tradingCronLogger.info(`[TradingCron] Batch summary: 1 configs, 1 succeeded, 0 failed`);
    tradingCronLogger.info(`[TradingCron] Total processed so far: 1`);
    tradingCronLogger.info(`[TradingCron] All configs processed. Breaking loop.`);

    const duration = Date.now() - cycleStart;
    tradingCronLogger.info('='.repeat(80));
    tradingCronLogger.info('[TradingCron] ========== CYCLE COMPLETE ==========');
    tradingCronLogger.info('[TradingCron] Total Processed: 1');
    tradingCronLogger.info('[TradingCron] Succeeded: 1 | Failed: 0');
    tradingCronLogger.info(`[TradingCron] Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s) | Heap: 45MB / 72MB`);
    tradingCronLogger.info('='.repeat(80));

    endCycleLogging();

    // Verify content of generated log file
    const content = fs.readFileSync(activeFile, 'utf8');
    const lines = content.trim().split('\n');

    console.log(`\nVerified file: ${activeFile} (${lines.length} lines)`);
    console.log('\nSample log preview (first 15 lines):');
    console.log(lines.slice(0, 15).join('\n'));
    console.log('\nSample log preview (last 10 lines):');
    console.log(lines.slice(-10).join('\n'));

    // Assertions
    const hasIsoTimestamp = lines.every(l => {
        const trimmed = l.trim();
        return !trimmed || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(trimmed) || /^\s*[{}]/.test(l) || /^\s+["'\w]+:/.test(l) || /^\s+ENTRY|\s+CONFIRMATION|\s+STRUCTURE/.test(l);
    });

    if (!hasIsoTimestamp) {
        throw new Error('Some lines are missing ISO timestamps!');
    }

    if (!content.includes('[TradingCron] ========== CYCLE START ==========')) {
        throw new Error('Missing CYCLE START banner');
    }

    if (!content.includes('[TradingCron] ========== CYCLE COMPLETE ==========')) {
        throw new Error('Missing CYCLE COMPLETE banner');
    }

    if (!content.includes('[MarketData] Candlestick Data Fetched:')) {
        throw new Error('Missing Candlestick Data block');
    }

    console.log('\n✅ ALL PONRAJ CYCLE LOGGING CHECKS PASSED PERFECTLY!');
}

testPonrajCycleLogging().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
