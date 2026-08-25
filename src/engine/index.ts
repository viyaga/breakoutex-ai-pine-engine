// ================================================================
// Pine Engine Core — runs one full trading cycle for a bot
// Supports single and Multi-Timeframe (MTF) strategies
// ================================================================

import { IExchangeClient, resolutionMs } from '../exchange/exchange.interface';
import { createExchangeClient } from '../exchange/exchange.factory';
import { evaluatePineScript, extractRequestedTimeframes, normalizeTimeframe } from '../pine/interpreter';
import { PineTradeState } from '../models/tradeState.model';
import { PineBotConfig } from '../config/types';
import { syncLeverage, handleOpenTrade, getOrCreateState } from './position-manager';
import { executeTrade } from './trade-executor';
import { Candle } from '../config/types';
import { isAiEvaluationDue, evaluateAndApplyAiStrategy } from './ai-market-evaluator';

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
        case '1m': return 25 * 1000;       // 25s
        case '3m': return 60 * 1000;       // 1m
        case '5m': return 50 * 1000;       // 50s (protects across cycle iterations)
        case '15m': return 3 * 60 * 1000;   // 3m (15m candle doesn't change closed bars for 15m)
        case '30m': return 5 * 60 * 1000;   // 5m
        case '1h':
        case '60': return 10 * 60 * 1000;  // 10m (1h candle doesn't change closed bars for 60m)
        case '2h':
        case '120': return 20 * 60 * 1000; // 20m
        case '4h':
        case '240': return 30 * 60 * 1000; // 30m (4h candle only closes every 4 hours)
        case '1d':
        case 'D': return 60 * 60 * 1000;   // 1 hour
        default: return 60 * 1000;
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

async function fetchTimeframeCandles(
    client: IExchangeClient,
    symbol: string,
    timeframe: string
): Promise<Candle[] | null> {
    const normTf = normalizeTimeframe(timeframe);
    const key = `${symbol.toUpperCase().trim()}:${normTf}`;
    const now = Date.now();

    // 1. Check TTL Cache (Zero exchange API calls if valid)
    const cached = smartCandleCache.get(key);
    if (cached && now - cached.cachedAt < cached.ttlMs) {
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
    const activeOpenCount = await PineTradeState.countDocuments({
        botId: c.id,
        status: 'open',
        tradeOutcome: 'pending',
    });
    if (activeOpenCount >= maxTrades) {
        return { ok: false, reason: `Max concurrent trades limit reached (${activeOpenCount}/${maxTrades})` };
    }

    return { ok: true };
}

export async function runPineCycle(c: PineBotConfig): Promise<void> {
    const botId = c.id;

    if (!c.SYMBOL) {
        console.warn(`[PineEngine][${botId}] No SYMBOL — skipping`);
        return;
    }

    const client = createExchangeClient(c);


    // AI Managed Bot: evaluate market regime directly via Gemini across 5m, 15m, 1h, and 4h
    const isAiDue = !c.LAST_AI_EVALUATION || (!c.PINE_SCRIPT?.trim() && c.CURRENT_STRATEGY_ID !== 'stand_aside') || isAiEvaluationDue(c);
    if (c.IS_AI_MANAGED && isAiDue) {
        try {
            const [baseTfCandles, tf15mCandles, tf1hCandles, tf4hCandles] = await Promise.all([
                fetchTimeframeCandles(client, c.SYMBOL, c.TIMEFRAME || '5m'),
                fetchTimeframeCandles(client, c.SYMBOL, '15m'),
                fetchTimeframeCandles(client, c.SYMBOL, '1h'),
                fetchTimeframeCandles(client, c.SYMBOL, '4h'),
            ]);
            if (baseTfCandles && baseTfCandles.length) {
                await evaluateAndApplyAiStrategy(
                    c,
                    baseTfCandles,
                    tf15mCandles ?? undefined,
                    tf1hCandles ?? undefined,
                    tf4hCandles ?? undefined
                );
            }
        } catch (evalErr: any) {
            console.error(`[PineEngine][${botId}] AI Market Evaluation failed:`, evalErr?.message ?? evalErr);
        }
    }


    if (!c.PINE_SCRIPT?.trim()) {
        if (c.IS_AI_MANAGED && c.CURRENT_STRATEGY_ID === 'stand_aside') {
            console.log(`[PineEngine][${botId}] ⏸️ AI Status: STANDING ASIDE (${c.AI_REASONING || 'Market condition unfavorable'}) — skipping trade entry`);
        } else {
            console.warn(`[PineEngine][${botId}] No Pine Script — skipping`);
        }
        return;
    }

    console.log(`[PineEngine][${botId}] ── START ${c.SYMBOL} ${c.IS_AI_MANAGED ? '(AI Managed)' : ''} ──`);

    try {
        // 1. Sync leverage (non-blocking)
        await syncLeverage(client, c);

        // 2. Identify all required timeframes (Multi-Timeframe support)
        const requiredTfs = extractRequestedTimeframes(c.PINE_SCRIPT, c.TIMEFRAME);
        console.log(`[PineEngine][${botId}] Required Timeframes: ${requiredTfs.join(', ')}`);

        // 3. Fetch candles for all timeframes in parallel
        const candleMap = new Map<string, Candle[]>();
        await Promise.all(
            requiredTfs.map(async tf => {
                const cList = await fetchTimeframeCandles(client, c.SYMBOL, tf);
                if (cList) candleMap.set(normalizeTimeframe(tf), cList);
            })
        );

        const baseNormTf = normalizeTimeframe(c.TIMEFRAME);
        const baseCandles = candleMap.get(baseNormTf);
        if (!baseCandles || !baseCandles.length) {
            console.log(`[PineEngine][${botId}] No base candles (${c.TIMEFRAME}) — skip`);
            return;
        }

        console.log(`[PineEngine][${botId}] Loaded ${candleMap.size} TF series (Base ${baseNormTf}: ${baseCandles.length} bars)`);

        // 4. Load trade state
        const state = await getOrCreateState(c);

        // 5. Handle open/pending trade
        if (state.entryOrderId && state.tradeOutcome === 'pending') {
            const { isStillOpen } = await handleOpenTrade(client, state, c);
            if (isStillOpen) {
                console.log(`[PineEngine][${botId}] Trade still open — no new entry`);
                return;
            }
            await getOrCreateState(c);
        }

        // 6. Safety check (Daily loss limit, Weekend filter, Concurrent trades)
        const safetyCheck = await canEnterTrade(state, c);
        if (!safetyCheck.ok) {
            console.log(`[PineEngine][${botId}] Safety check failed: ${safetyCheck.reason}`);
            return;
        }

        // 7. Evaluate Pine Script (with full MTF map)
        const signal = evaluatePineScript(c.PINE_SCRIPT, candleMap, c.TIMEFRAME);
        console.log(`[PineEngine][${botId}] Signal: action=${signal.action} score=${signal.score ?? 'N/A'} comment="${signal.comment ?? ''}"`);

        if (signal.action === 'none' || signal.action === 'close') {
            if (signal.action === 'close' && state.entryOrderId) {
                console.log(`[PineEngine][${botId}] Close signal — position management active`);
            }
            return;
        }

        // 8. Min Score Gating Check
        const minScoreThreshold = Math.max(0, c.MIN_SCORE || 50);
        if (signal.score !== undefined && signal.score < minScoreThreshold) {
            console.log(`[PineEngine][${botId}] Signal suppressed: score (${signal.score}) < required minScore (${minScoreThreshold})`);
            return;
        }

        // 9. Execute trade
        const side = signal.action === 'buy' ? 'buy' : 'sell';
        await executeTrade(client, c, side, state, signal.tp, signal.sl);

    } catch (err: any) {
        const msg = String(err?.message ?? err);
        console.error(`[PineEngine][${botId}] Error: ${msg}`);
        await handleBotError(botId, msg);
    }

    console.log(`[PineEngine][${botId}] ── DONE ──`);
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
