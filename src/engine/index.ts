// ================================================================
// Pine Engine Core — runs one full trading cycle for a bot
// Supports single and Multi-Timeframe (MTF) strategies
// ================================================================

import { IExchangeClient, resolutionMs } from '../exchange/exchange.interface';
import { createExchangeClient } from '../exchange/exchange.factory';
import { evaluatePineScript, extractRequestedTimeframes, normalizeTimeframe } from '../interpreter';
import { PineTradeState } from '../models/tradeState.model';
import { PineBotConfig } from '../config/types';
import { syncLeverage, handleOpenTrade, getOrCreateState, PineStateTracker } from './position-manager';
import { executeTrade } from './trade-executor';
import { Candle } from '../config/types';
import { isAiEvaluationDue, evaluateAndApplyAiStrategy, computeMarketSnapshot } from './ai-market-evaluator';
import { BotCycleLogger, tradingCycleLogger, marketDataLogger, positionManagerLogger } from '../utils/cycle-logger';
import { StrategyPerformanceTracker } from './strategy-performance-tracker';

// Multi-Timeframe TTL Smart Candle Cache across all bots and cycles
interface CandleCacheEntry {
    candles: Candle[];
    cachedAt: number;
    ttlMs: number;
}

const smartCandleCache = new Map<string, CandleCacheEntry>();
const pendingFetches = new Map<string, Promise<Candle[] | null>>();

function getTtlForTimeframe(normTf: string): number {
    switch (normTf) {
        case '1m': return 45 * 1000;              // 45s
        case '3m': return 2 * 60 * 1000;          // 2m
        case '5m': return 3.5 * 60 * 1000;        // 3.5m (safely protects across 3-4 cycles for closed 5m bars)
        case '15m': return 10 * 60 * 1000;        // 10m (closed 15m bars remain static for 15m)
        case '30m': return 20 * 60 * 1000;        // 20m
        case '1h':
        case '60': return 45 * 60 * 1000;         // 45m (1h closed bars don't change for 60m)
        case '2h':
        case '120': return 90 * 60 * 1000;        // 90m
        case '4h':
        case '240': return 3 * 60 * 60 * 1000;    // 3 hours (4h candle closes only every 4h)
        case '1d':
        case 'D': return 6 * 60 * 60 * 1000;      // 6 hours
        default: return 3 * 60 * 1000;
    }
}

export function clearCycleCache() {
    // Clean up expired cache entries while keeping valid higher timeframe data intact
    const now = Date.now();
    for (const [key, entry] of smartCandleCache.entries()) {
        if (now - entry.cachedAt >= entry.ttlMs) {
            smartCandleCache.delete(key);
        }
    }
}

function formatCandleTarget(candle: Candle): string {
    const color = candle.close >= candle.open ? 'green' : 'red';
    return `Target: [O:${candle.open}, H:${candle.high}, L:${candle.low}, C:${candle.close}, Color:${color}]`;
}

async function fetchTimeframeCandles(
    client: IExchangeClient,
    symbol: string,
    timeframe: string,
    logger?: BotCycleLogger
): Promise<Candle[] | null> {
    const normTf = normalizeTimeframe(timeframe);
    const key = `${symbol.toUpperCase().trim()}:${normTf}`;
    const now = Date.now();

    // 1. Check TTL Cache (Zero exchange API calls if valid)
    const cached = smartCandleCache.get(key);
    if (cached && now - cached.cachedAt < cached.ttlMs) {
        const cacheMsg = `[MarketData] 📦 Cache Hit: ${key} (${cached.candles.length} bars, age ${Math.round((now - cached.cachedAt) / 1000)}s / TTL ${Math.round(cached.ttlMs / 1000)}s)`;
        if (logger) logger.addLog(cacheMsg);
        return cached.candles;
    }

    // 2. Check In-Flight Request (deduplicate simultaneous requests from multiple bots on same symbol/TF)
    if (pendingFetches.has(key)) {
        return pendingFetches.get(key)!;
    }

    // 3. Initiate fetch with request collapsing
    const fetchPromise = (async () => {
        try {
            const candles = await client.getCandles(symbol, normTf, 350);
            if (!candles || !candles.length) return null;

            // Only use closed candles
            const dur = resolutionMs(normTf);
            const currentBarTs = Math.floor(Date.now() / dur) * dur;
            const closed = candles.filter(c => c.timestamp < currentBarTs);
            if (!closed.length) return null;

            smartCandleCache.set(key, {
                candles: closed,
                cachedAt: Date.now(),
                ttlMs: getTtlForTimeframe(normTf),
            });

            return closed;
        } finally {
            pendingFetches.delete(key);
        }
    })();

    pendingFetches.set(key, fetchPromise);
    return fetchPromise;
}

/** Safety checks before allowing a new trade */
async function canEnterTrade(state: any, c: PineBotConfig): Promise<{ ok: boolean; reason?: string }> {
    // 1. Daily loss limit
    const limit = c.CAPITAL_AMOUNT * (c.DAILY_LOSS_LIMIT / 100);
    if (state.dailyPnl < 0 && Math.abs(state.dailyPnl) >= limit && limit > 0) {
        return { ok: false, reason: `Daily loss limit reached ($${Math.abs(state.dailyPnl).toFixed(2)} / $${limit.toFixed(2)})` };
    }

    // 2. Weekend safety filter
    if (c.IS_WEEKEND_SAFETY_ENABLED) {
        const day = new Date().getUTCDay();
        if (day === 0 || day === 6) return { ok: false, reason: 'Weekend safety filter active' };
    }

    // 3. Max concurrent trades limit
    const maxTrades = Math.max(1, c.MAX_CONCURRENT_TRADES || 1);
    const hasPending = PineStateTracker.hasPendingTrade(c.id);
    let activeOpenCount = 0;

    if (hasPending) {
        if (maxTrades === 1) {
            activeOpenCount = 1;
        } else {
            activeOpenCount = await PineTradeState.countDocuments({
                botId: c.id,
                status: 'open',
                tradeOutcome: 'pending',
            });
        }
    }

    if (activeOpenCount >= maxTrades) {
        return { ok: false, reason: `Max concurrent trades limit reached (${activeOpenCount}/${maxTrades})` };
    }

    return { ok: true };
}

export async function runPineCycle(c: PineBotConfig): Promise<void> {
    const botId = c.id;
    const botStartTime = Date.now();
    const cycleId = `cycle-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    if (!c.SYMBOL) {
        tradingCycleLogger.warn(`[TradingCycle] No SYMBOL for bot ${botId} — skipping`);
        return;
    }

    const logger = new BotCycleLogger(botId, c.SYMBOL, cycleId);
    const context = { cycleId, symbol: c.SYMBOL, tradingBotId: botId };

    tradingCycleLogger.info(
        `[TradingCycle] ========== START PROCESSING BOT: ${c.SYMBOL} (ID: ${botId}) ==========`,
        context
    );

    tradingCycleLogger.info(
        `[Config] Bot Configuration: Mode=${c.MODE || 'balanced'} | Capital=$${c.CAPITAL_AMOUNT} | Leverage=${c.LEVERAGE}x | TF=${c.TIMEFRAME} | AI_Managed=${Boolean(c.IS_AI_MANAGED)} | MinScore=${c.MIN_SCORE || 50}`,
        context
    );

    const client = createExchangeClient(c, logger);

    try {
        // AI Managed Bot: evaluate market regime directly via Gemini across 5m, 15m, 1h, and 4h
        const isAiDue = isAiEvaluationDue(c) || (!c.PINE_SCRIPT?.trim() && c.CURRENT_STRATEGY_ID !== 'stand_aside');
        if (c.IS_AI_MANAGED && isAiDue) {
            try {
                const [baseTfCandles, tf15mCandles, tf1hCandles, tf4hCandles] = await Promise.all([
                    fetchTimeframeCandles(client, c.SYMBOL, c.TIMEFRAME || '5m', logger),
                    fetchTimeframeCandles(client, c.SYMBOL, '15m', logger),
                    fetchTimeframeCandles(client, c.SYMBOL, '1h', logger),
                    fetchTimeframeCandles(client, c.SYMBOL, '4h', logger),
                ]);
                if (baseTfCandles && baseTfCandles.length) {
                    await evaluateAndApplyAiStrategy(
                        c,
                        baseTfCandles,
                        tf15mCandles ?? undefined,
                        tf1hCandles ?? undefined,
                        tf4hCandles ?? undefined,
                        logger
                    );
                }
            } catch (evalErr: any) {
                const evalMsg = `AI Market Evaluation failed: ${evalErr?.message ?? evalErr}`;
                logger.error(evalMsg);
            }
        } else if (c.IS_AI_MANAGED) {
            const stratName = c.CURRENT_STRATEGY_NAME || c.CURRENT_STRATEGY_ID || 'Active Strategy';
            tradingCycleLogger.info(`[AIMarketEvaluator] 🤖 Active AI Strategy: "${stratName}" (Regime: ${c.MARKET_CONDITION || 'detected'})`, context);
        }

        if (!c.PINE_SCRIPT?.trim()) {
            if (c.IS_AI_MANAGED && c.CURRENT_STRATEGY_ID === 'stand_aside') {
                tradingCycleLogger.info(`[AIMarketEvaluator] ⏸️ AI Status: STANDING ASIDE (${c.AI_REASONING || 'Market condition unfavorable'}) — skipping trade entry`, context);
            } else {
                tradingCycleLogger.warn(`[PineEngine] No Pine Script configured — skipping`, context);
            }
            return;
        }

        // 1. Sync leverage
        tradingCycleLogger.info(`[LeverageSync] Checking leverage for product ${c.PRODUCT_ID || c.SYMBOL}...`, context);
        await syncLeverage(client, c, logger);

        // 2. Identify all required timeframes (Multi-Timeframe support)
        const requiredTfs = extractRequestedTimeframes(c.PINE_SCRIPT, c.TIMEFRAME);
        tradingCycleLogger.info(`[MarketData] Required Timeframes: ${requiredTfs.join(', ')}`, context);

        // 3. Fetch candles for all timeframes in parallel
        const candleMap = new Map<string, Candle[]>();
        await Promise.all(
            requiredTfs.map(async tf => {
                const cList = await fetchTimeframeCandles(client, c.SYMBOL, tf, logger);
                if (cList) candleMap.set(normalizeTimeframe(tf), cList);
            })
        );

        const baseNormTf = normalizeTimeframe(c.TIMEFRAME);
        const baseCandles = candleMap.get(baseNormTf);
        if (!baseCandles || !baseCandles.length) {
            marketDataLogger.warn(`[MarketData] SKIP: Missing closed candles for ${c.SYMBOL} on base timeframe (${c.TIMEFRAME})`, context);
            return;
        }

        // Ponraj-style Candlestick Data block
        const targetLines: string[] = [];
        const entryTarget = baseCandles[baseCandles.length - 1];
        targetLines.push(`          ENTRY (${c.TIMEFRAME}): ${baseCandles.length} candles, ${formatCandleTarget(entryTarget)}`);

        const confCandles = candleMap.get('15m') || candleMap.get('15');
        if (confCandles && confCandles.length) {
            const target = confCandles[confCandles.length - 1];
            targetLines.push(`          CONFIRMATION (15m): ${confCandles.length} candles, ${formatCandleTarget(target)}`);
        }
        const structCandles = candleMap.get('1h') || candleMap.get('60');
        if (structCandles && structCandles.length) {
            const target = structCandles[structCandles.length - 1];
            targetLines.push(`          STRUCTURE (1h): ${structCandles.length} candles, ${formatCandleTarget(target)}`);
        }
        const macroCandles = candleMap.get('4h') || candleMap.get('240');
        if (macroCandles && macroCandles.length) {
            const target = macroCandles[macroCandles.length - 1];
            targetLines.push(`          MACRO (4h): ${macroCandles.length} candles, ${formatCandleTarget(target)}`);
        }

        marketDataLogger.info(`[MarketData] Candlestick Data Fetched:\n${targetLines.join('\n')}`, context);

        const currentPrice = entryTarget.close;
        marketDataLogger.debug(`[MarketPrice] Fetching latest price for ${c.SYMBOL}...`, context);
        marketDataLogger.info(`[MarketPrice] Current Mark Price: ${currentPrice}`, context);

        // 4. Load trade state
        const state = await getOrCreateState(c);
        const stratId = c.CURRENT_STRATEGY_ID || 'default';
        const cooldownCheck = StrategyPerformanceTracker.isStrategyInCooldown(c.SYMBOL, stratId);
        const cooldownStatus = cooldownCheck.inCooldown
            ? `Active (${cooldownCheck.remainingMinutes}m remaining)`
            : 'None';
        const stateId = (state as any)._id?.toString() || botId;
        tradingCycleLogger.info(
            `[State] Loaded state: ID=${stateId}, Outcome=${state.tradeOutcome}, Status=${state.status}, DailyPnL=$${(state.dailyPnl || 0).toFixed(2)}, Cooldown=${cooldownStatus}`,
            context
        );

        // 5. Handle open/pending trade
        if (state.entryOrderId && state.tradeOutcome === 'pending') {
            const { isStillOpen } = await handleOpenTrade(client, state, c, logger);
            if (isStillOpen) {
                positionManagerLogger.info(
                    `[PositionManager] Position is active. Managing existing position. No new entries allowed.`,
                    context
                );
                return;
            }
            await getOrCreateState(c);
        }

        // 6. Safety check (Daily loss limit, Weekend filter, Concurrent trades)
        const safetyCheck = await canEnterTrade(state, c);
        if (!safetyCheck.ok) {
            tradingCycleLogger.info(`[SafetyCheck] SKIP: ${safetyCheck.reason}`, context);
            return;
        }

        // 7. Compute & Log Multi-Timeframe Technical Indicator Snapshot
        const triggerSnapshot = computeMarketSnapshot(
            baseCandles,
            candleMap.get('15m') || candleMap.get('15'),
            candleMap.get('1h') || candleMap.get('60'),
            candleMap.get('4h') || candleMap.get('240')
        );

        logger.addLog(`[Technical Indicator Snapshot @ Trigger]`);
        logger.addLog(`  5M: Price=$${triggerSnapshot.currentPrice.toFixed(2)} | 24h=${triggerSnapshot.change24h}% | RSI=${triggerSnapshot.rsi} | EMA=${triggerSnapshot.emaTrend} | ADX=${triggerSnapshot.adx} (+DI:${triggerSnapshot.diPlus}, -DI:${triggerSnapshot.diMinus}) | ATR=${triggerSnapshot.atrPercent}% ($${triggerSnapshot.atr}) | BBW=${triggerSnapshot.bbWidth} (Squeeze: ${triggerSnapshot.isBbSqueeze}) | VolRatio=${triggerSnapshot.volumeRatio}x`);
        logger.addLog(`  15M: Trend=${triggerSnapshot.htf15mTrend} | RSI=${triggerSnapshot.htf15mRsi}`);
        logger.addLog(`  1H: Trend=${triggerSnapshot.htf1hTrend} | RSI=${triggerSnapshot.htf1hRsi}`);
        logger.addLog(`  4H: MacroTrend=${triggerSnapshot.htf4hTrend}`);

        // 8. Evaluate Pine Script (with full MTF map)
        const signal = evaluatePineScript(c.PINE_SCRIPT, candleMap, c.TIMEFRAME);
        logger.setScore(signal.score);

        tradingCycleLogger.info(
            `[Signal] Action=${signal.action.toUpperCase()} | Score=${signal.score ?? 'N/A'} | Strategy="${c.CURRENT_STRATEGY_NAME || c.CURRENT_STRATEGY_ID || 'Pine'}" | Comment="${signal.comment ?? ''}"`,
            context
        );

        if (signal.action === 'none' || signal.action === 'close') {
            if (signal.action === 'close' && state.entryOrderId) {
                positionManagerLogger.info(`[PositionManager] Close signal received — closing position`, context);
            }
            return;
        }

        // 9. Min Score Gating Check
        const minScoreThreshold = Math.max(0, c.MIN_SCORE || 50);
        if (signal.score !== undefined && signal.score < minScoreThreshold) {
            tradingCycleLogger.info(`[SignalGating] Signal suppressed: score (${signal.score}) < required minScore (${minScoreThreshold})`, context);
            return;
        }

        // 10. Execute trade
        const side = signal.action === 'buy' ? 'buy' : 'sell';
        await executeTrade(client, c, side, state, signal.tp, signal.sl, logger);

    } catch (err: any) {
        const msg = String(err?.message ?? err);
        tradingCycleLogger.error(`[TradingCycle] Bot error: ${msg}`, context);
        await handleBotError(botId, msg);
    } finally {
        const botDur = Date.now() - botStartTime;
        tradingCycleLogger.info(
            `[TradingCycle] ========== END PROCESSING BOT: ${c.SYMBOL} (ID: ${botId}) ========== (Duration: ${botDur}ms)`,
            context
        );
        await logger.finalize();
    }
}

async function handleBotError(botId: string, message: string): Promise<void> {
    const { PineBotError } = await import('../models/tradeState.model');
    const stop = (
        message.toLowerCase().includes('insufficient_balance') ||
        message.toLowerCase().includes('ip_not_whitelisted') ||
        message.toLowerCase().includes('invalid_api_key')
    );
    await PineBotError.findOneAndUpdate(
        { botId },
        { message: message.substring(0, 200), status: stop ? 'stopped' : undefined, isActive: stop ? false : undefined, updatedAt: new Date() },
        { upsert: true }
    );
}
