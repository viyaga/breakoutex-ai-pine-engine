// ================================================================
// Pine Engine Core — runs one full trading cycle for a bot
// Supports single and Multi-Timeframe (MTF) strategies
// ================================================================

import { DeltaClient, resolutionMs } from '../exchange/delta.client';
import { evaluatePineScript, extractRequestedTimeframes, normalizeTimeframe } from '../pine/interpreter';
import { PineTradeState } from '../models/tradeState.model';
import { PineBotConfig } from '../config/types';
import { syncLeverage, handleOpenTrade, getOrCreateState } from './position-manager';
import { executeTrade } from './trade-executor';
import { Candle } from '../config/types';
import { isAiEvaluationDue, evaluateAndApplyAiStrategy } from './ai-market-evaluator';

// Per-cycle candle cache (cleared at start of each cron cycle)
const cycleCache = new Map<string, Candle[]>();
export function clearCycleCache() { cycleCache.clear(); }

async function fetchTimeframeCandles(
    client: DeltaClient,
    symbol: string,
    timeframe: string
): Promise<Candle[] | null> {
    const normTf = normalizeTimeframe(timeframe);
    const key = `${symbol}:${normTf}`;
    if (cycleCache.has(key)) return cycleCache.get(key)!;

    const candles = await client.getCandles(symbol, normTf, 200);
    if (!candles || !candles.length) return null;

    // Only use closed candles
    const dur     = resolutionMs(normTf);
    const now     = Date.now();
    const current = Math.floor(now / dur) * dur;
    const closed  = candles.filter(c => c.timestamp < current);
    if (!closed.length) return null;

    cycleCache.set(key, closed);
    return closed;
}

/** Safety checks before allowing a new trade */
function canEnterTrade(state: any, c: PineBotConfig): { ok: boolean; reason?: string } {
    // Daily loss limit
    const limit = c.CAPITAL_AMOUNT * (c.DAILY_LOSS_LIMIT / 100);
    if (state.dailyPnl < 0 && Math.abs(state.dailyPnl) >= limit && limit > 0) {
        return { ok: false, reason: `Daily loss limit reached ($${Math.abs(state.dailyPnl).toFixed(2)} / $${limit.toFixed(2)})` };
    }

    // Weekend safety
    if (c.IS_WEEKEND_SAFETY_ENABLED) {
        const day = new Date().getUTCDay();
        if (day === 0 || day === 6) return { ok: false, reason: 'Weekend safety filter active' };
    }

    return { ok: true };
}

export async function runPineCycle(c: PineBotConfig): Promise<void> {
    const botId = c.id;

    if (!c.PRODUCT_ID) {
        console.warn(`[PineEngine][${botId}] No PRODUCT_ID — skipping`);
        return;
    }

    const client = new DeltaClient(c.API_KEY, c.SECRET_KEY, c.BASE_URL);

    // AI Managed Bot: evaluate market regime and select strategy from library every 6 hours
    if (c.IS_AI_MANAGED && (!c.PINE_SCRIPT?.trim() || isAiEvaluationDue(c))) {
        try {
            const baseTfCandles = await fetchTimeframeCandles(client, c.SYMBOL, c.TIMEFRAME || '5m');
            if (baseTfCandles && baseTfCandles.length) {
                await evaluateAndApplyAiStrategy(c, baseTfCandles);
            }
        } catch (evalErr: any) {
            console.error(`[PineEngine][${botId}] AI Market Evaluation failed:`, evalErr?.message ?? evalErr);
        }
    }

    if (!c.PINE_SCRIPT?.trim()) {
        console.warn(`[PineEngine][${botId}] No Pine Script — skipping`);
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

        // 6. Safety check
        const safetyCheck = canEnterTrade(state, c);
        if (!safetyCheck.ok) {
            console.log(`[PineEngine][${botId}] Safety check failed: ${safetyCheck.reason}`);
            return;
        }

        // 7. Evaluate Pine Script (with full MTF map)
        const signal = evaluatePineScript(c.PINE_SCRIPT, candleMap, c.TIMEFRAME);
        console.log(`[PineEngine][${botId}] Signal: action=${signal.action} comment="${signal.comment ?? ''}"`);

        if (signal.action === 'none' || signal.action === 'close') {
            if (signal.action === 'close' && state.entryOrderId) {
                console.log(`[PineEngine][${botId}] Close signal — position management not yet active`);
            }
            return;
        }

        // 8. Execute trade
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
