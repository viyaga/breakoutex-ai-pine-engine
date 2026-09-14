import fs from 'fs';
import path from 'path';
import {
    startCycleLogging,
    endCycleLogging,
    getActiveLogFile,
    tradingCronLogger,
    tradingCycleLogger,
    marketDataLogger,
    brokerAdapterLogger,
    optionEngineLogger,
    optionRiskLogger,
    BotCycleLogger
} from '../utils/cycle-logger';
import { InstrumentService } from '../instruments/InstrumentService';
import { OptionChainService } from '../instruments/OptionChainService';
import { OptionRiskEngine } from '../risk/OptionRiskEngine';

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
    if (condition) {
        console.log(`  ${colors.green}✔ PASS:${colors.reset} ${msg}`);
        passed++;
    } else {
        console.error(`  ${colors.red}✖ FAIL:${colors.reset} ${msg}`);
        failed++;
    }
}

async function testMultiMarketCycleLogging() {
    console.log(`\n${colors.bright}${colors.cyan}=================================================================\n  🚀 MULTI-MARKET & INDIAN OPTIONS CYCLE LOGGING VERIFICATION\n=================================================================${colors.reset}\n`);

    // 1. Initialize cycle logging
    startCycleLogging();
    const activeFile = getActiveLogFile();
    assert(activeFile !== null, 'Active cycle log file path generated');

    const botId = 'bot_zerodha_nifty_opt_01';
    const symbol = 'NIFTY';
    const cycleId = `cycle-${Date.now()}-ind01`;
    const context = { cycleId, symbol, tradingBotId: botId };

    const cycleLogger = new BotCycleLogger(botId, symbol, cycleId);
    assert(fs.existsSync(activeFile!), 'Active cycle log file created on disk upon first log write');

    // 2. Load instrument master fixtures
    const instrumentService = InstrumentService.getInstance();
    instrumentService.clear();
    instrumentService.loadInstruments([
        {
            instrumentToken: 256265,
            tradingsymbol: 'NIFTY 50',
            underlying: 'NIFTY',
            exchange: 'NSE',
            lotSize: 75,
            tickSize: 0.05,
        },
        {
            instrumentToken: 11223344,
            tradingsymbol: 'NIFTY24SEP25100CE',
            underlying: 'NIFTY',
            exchange: 'NFO',
            optionType: 'CE',
            strike: 25100,
            expiry: '2026-09-26',
            lotSize: 75,
            tickSize: 0.05,
        },
    ]);

    const dynamicLot = instrumentService.getLotSize('NIFTY');
    assert(dynamicLot === 75, `Dynamic lot size for NIFTY resolved: ${dynamicLot}`);

    // 3. Log Multi-Market Bot Configuration
    cycleLogger.logMultiMarketConfig({
        marketType: 'indian_stock',
        exchange: 'zerodha',
        underlying: 'NIFTY',
        strikePreference: 'ATM',
        expiryPreference: 'NEAREST_WEEKLY',
        directionMode: 'AI_DIRECTIONAL',
        lotsCount: 2,
        lotSize: dynamicLot,
        capitalAmount: 50000,
        currency: 'INR',
    });

    tradingCycleLogger.info(
        `[MultiMarket] Indian Option Buying: Underlying=NIFTY | DynamicLot=75 | StrikePref=ATM | ExpiryPref=NEAREST_WEEKLY | DirectionMode=AI_DIRECTIONAL | Lots=2`,
        context
    );

    // 4. Spot Price & ATM Strike Calculation
    const spotPrice = 25123.40;
    const strikeStep = OptionChainService.getStrikeStep('NIFTY');
    const atmStrike = InstrumentService.calculateAtmStrike(spotPrice, strikeStep);

    cycleLogger.addLog(`[OptionEngine][${botId}] Spot NIFTY Index = ${spotPrice.toFixed(2)} | ATM Strike = ${atmStrike} (Strike Interval: ${strikeStep})`);
    optionEngineLogger.info(
        `[OptionEngine] Spot Index: NIFTY = ${spotPrice.toFixed(2)} | ATM Strike = ${atmStrike} (Step = ${strikeStep})`,
        context
    );

    // 5. Option Strike Selection & Contract Derivation
    const optionChainService = new OptionChainService();
    const targetOptionType = 'CE';
    const targetStrike = optionChainService.calculateTargetStrike('NIFTY', spotPrice, targetOptionType, 'ATM');
    const tradingsymbol = `NIFTY24SEP${targetStrike}CE`;

    cycleLogger.logOptionStrikeSelection({
        underlying: 'NIFTY',
        spotPrice,
        strikeStep,
        atmStrike,
        signalDirection: 'LONG',
        selectedOptionType: targetOptionType,
        targetStrike,
        tradingsymbol,
        expiry: '2026-09-26',
        lotSize: dynamicLot,
    });

    // 6. Option Risk & Capital Sizing Evaluation
    const estimatedPremium = 160; // ₹160 per share
    const sizingResult = OptionRiskEngine.calculateOptionSizing({
        totalCapital: 50000,
        maxRiskPerTradePercent: 10, // ₹5,000 max risk
        optionPremium: estimatedPremium,
        lotSize: dynamicLot,
        stopLossPercent: 20,       // 20% SL
        maxLotsLimit: 2,
        currentDailyLoss: 0,
        maxDailyLossLimit: 10000,
    });

    cycleLogger.logOptionRiskEvaluation({
        capital: 50000,
        optionPremium: estimatedPremium,
        lotSize: dynamicLot,
        lots: sizingResult.lots,
        totalQuantity: sizingResult.totalQuantity,
        capitalRequired: sizingResult.estimatedCapitalRequired,
        stopLossPercent: 20,
        slPrice: sizingResult.slPrice,
        tpPrice: sizingResult.tpPrice,
        riskAmount: sizingResult.riskAmount,
        circuitBreakerAllowed: sizingResult.allowed,
        circuitBreakerReason: sizingResult.reason,
    });

    // 7. Broker Adapter Routing
    cycleLogger.logBrokerRouting({
        broker: 'zerodha',
        action: 'BUY',
        tradingsymbol,
        quantity: sizingResult.totalQuantity,
        orderType: 'MARKET',
        product: 'MIS',
        orderId: 'KITE_ORD_987654321',
        status: 'SUBMITTED',
        durationMs: 42,
    });

    brokerAdapterLogger.info(
        `[BrokerRouting] Prepared BUY order for ${sizingResult.totalQuantity} Qty of ${tradingsymbol} via ZERODHA`,
        context
    );

    // Finalize bot cycle logger
    await cycleLogger.finalize(75);
    endCycleLogging();

    // 8. Verify cycle log file content on disk
    const logContent = fs.readFileSync(activeFile!, 'utf-8');

    assert(logContent.includes('[MultiMarket]'), 'Cycle log contains [MultiMarket] section');
    assert(logContent.includes('INDIAN OPTIONS / BROKER CONFIGURATION'), 'Cycle log contains Indian options configuration');
    assert(logContent.includes('Spot Index: NIFTY = 25123.40 | ATM Strike = 25100'), 'Cycle log contains exact Spot price & ATM Strike');
    assert(logContent.includes('[OptionEngine]'), 'Cycle log contains [OptionEngine] subsystem logs');
    assert(logContent.includes('NIFTY24SEP25100CE'), 'Cycle log contains selected option contract tradingsymbol');
    assert(logContent.includes('[OptionRisk]'), 'Cycle log contains [OptionRisk] subsystem logs');
    assert(logContent.includes('Affordable Lots: 2 (150 Qty)'), 'Cycle log contains dynamic risk sizing');
    assert(logContent.includes('Circuit Breaker:      NORMAL (Execution Permitted)'), 'Cycle log verifies circuit breaker health');
    assert(logContent.includes('[BrokerRouting]'), 'Cycle log contains [BrokerRouting] subsystem logs');
    assert(logContent.includes('EXECUTION ROUTED TO ZERODHA'), 'Cycle log verifies broker routing to Zerodha');

    console.log(`\n=================================================================`);
    console.log(`  📊 CYCLE LOGGING TEST RESULTS: ${colors.green}${passed} passed${colors.reset}, ${failed > 0 ? colors.red : colors.green}${failed} failed${colors.reset}`);
    console.log(`=================================================================\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

testMultiMarketCycleLogging().catch((err) => {
    console.error('Fatal Multi-Market Cycle Logging Test Error:', err);
    process.exit(1);
});
