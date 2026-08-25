// ================================================================
// Position Manager — handles open trade lifecycle
// Checks if entry filled, TP hit, SL hit, updates state accordingly
// ================================================================

import { IExchangeClient } from '../exchange/exchange.interface';
import { PineTradeState, IPineTradeState, PineBotError } from '../models/tradeState.model';
import { PineBotConfig } from '../config/types';

function log(botId: string, msg: string) {
    console.log(`[PineEngine][${botId}] ${msg}`);
}

/** Sync leverage on the exchange, safely handles errors */
export async function syncLeverage(
    client: IExchangeClient,
    c: PineBotConfig,
    logger?: { addLog: (msg: string) => void; warn: (msg: string) => void }
): Promise<void> {
    try {
        const prodIdentifier = c.PRODUCT_ID || c.SYMBOL;
        await client.setLeverage(prodIdentifier, c.LEVERAGE, c.SYMBOL);
        const msg = `[LeverageSync] ✓ Successfully verified & synced ${c.LEVERAGE}x leverage for ${c.SYMBOL}`;
        if (logger) logger.addLog(msg);
        log(c.id, msg);
    } catch (err: any) {
        const warnMsg = `[LeverageSync] Leverage sync notice (non-fatal): ${err.message}`;
        if (logger) logger.warn(warnMsg);
        else console.warn(`[PineEngine][${c.id}] ${warnMsg}`);
    }
}

/**
 * Check and update a PENDING trade.
 * Returns updated state. Marks state closed if trade resolved.
 */
export async function handleOpenTrade(
    client: IExchangeClient,
    state: IPineTradeState,
    c: PineBotConfig,
    logger?: { addLog: (msg: string) => void }
): Promise<{ state: IPineTradeState; isStillOpen: boolean }> {
    const botId = c.id;

    if (!state.entryOrderId) return { state, isStillOpen: false };

    // 1. Get entry order status
    const entryOrder = await client.getOrder(state.entryOrderId, c.SYMBOL);
    if (!entryOrder) {
        const msg = `[PositionManager] Could not fetch entry order ${state.entryOrderId}`;
        if (logger) logger.addLog(msg);
        log(botId, msg);
        return { state, isStillOpen: true };
    }

    const entryStatus = (entryOrder.state ?? entryOrder.status ?? '').toUpperCase();
    const statusMsg = `[PositionManager] Entry order ${state.entryOrderId} status: ${entryStatus}`;
    if (logger) logger.addLog(statusMsg);
    log(botId, statusMsg);

    // If entry not filled yet, wait
    if (entryStatus === 'OPEN' || entryStatus === 'PENDING') {
        return { state, isStillOpen: true };
    }

    // If entry cancelled/failed, reset state
    if (entryStatus === 'CANCELLED') {
        const cancelMsg = '[PositionManager] Entry order cancelled on exchange. Resetting trade state.';
        if (logger) logger.addLog(cancelMsg);
        log(botId, cancelMsg);
        await PineTradeState.findByIdAndUpdate((state as any)._id, {
            tradeOutcome: 'cancelled',
            status: 'closed',
            exitPrice: null,
        });
        return { state, isStillOpen: false };
    }

    // Entry is CLOSED = filled. Now check if TP or SL was hit
    const prodIdentifier = c.PRODUCT_ID || c.SYMBOL;
    const pos = await client.getPosition(prodIdentifier, c.SYMBOL);
    const posSize = Number(pos?.size ?? 0);

    if (posSize !== 0) {
        // Position is still open — trade is alive
        return { state, isStillOpen: true };
    }

    // Position closed — determine outcome via SL/TP order
    const entryPrice  = Number(state.entryPrice ?? 0);
    const currentExit = Number(entryOrder.average_fill_price ?? entryOrder.limit_price ?? 0);

    let exitPrice = currentExit;
    let outcome: 'win' | 'loss' = 'win';

    // Check TP order if available
    if (state.takeProfitOrderId) {
        const tpOrder = await client.getOrder(state.takeProfitOrderId, c.SYMBOL).catch(() => null);
        const tpStatus = (tpOrder?.state ?? tpOrder?.status ?? '').toUpperCase();
        if (tpStatus === 'CLOSED') {
            exitPrice = Number(tpOrder.average_fill_price ?? state.tpPrice ?? 0);
            outcome = 'win';
        }
    }

    // Check SL order
    if (state.stopLossOrderId) {
        const slOrder = await client.getOrder(state.stopLossOrderId, c.SYMBOL).catch(() => null);
        const slStatus = (slOrder?.state ?? slOrder?.status ?? '').toUpperCase();
        if (slStatus === 'CLOSED') {
            exitPrice = Number(slOrder.average_fill_price ?? state.slPrice ?? 0);
            outcome = 'loss';
        }
    }

    // Compute PnL and fee accounting
    const qty  = Number(state.quantity ?? 0);
    const lot  = c.LOT_SIZE || 1;
    const side = state.side ?? 'buy';
    const notionalUSD = entryPrice * qty * lot;

    const rawPnl = side === 'buy'
        ? (exitPrice - entryPrice) * qty * lot
        : (entryPrice - exitPrice) * qty * lot;

    const feePercent = c.ESTIMATED_FEE_PERCENT / 100;
    const fees = notionalUSD * feePercent * 2; // round-trip entry + exit
    const netPnl = rawPnl - fees;
    const returnPct = notionalUSD > 0 ? (netPnl / notionalUSD) * 100 : 0;

    const newAllTimePnl = (state.allTimePnl ?? 0) + netPnl;
    const newDailyPnl   = (state.dailyPnl   ?? 0) + netPnl;

    // Calculate holding duration
    const now = new Date();
    const entryTime = state.entryFilledAt ? new Date(state.entryFilledAt).getTime() : now.getTime();
    const durationMs = Math.max(0, now.getTime() - entryTime);
    const durationMins = Math.floor(durationMs / 60000);
    const durationSecs = Math.floor((durationMs % 60000) / 1000);
    const durationStr = `${durationMins}m ${durationSecs}s`;

    const settlementLog = `[TradeSettlement] 🎯 TRADE CLOSED: Outcome=${outcome.toUpperCase()} (${outcome === 'win' ? 'TP Hit' : 'SL Hit'}) | Side=${side.toUpperCase()} ${qty}L | Entry=$${entryPrice.toFixed(2)} -> Exit=$${exitPrice.toFixed(2)} (${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%) | Duration=${durationStr} | GrossPnL=$${rawPnl.toFixed(2)} | Fees=$${fees.toFixed(2)} | NetPnL=$${netPnl.toFixed(2)} | NewDailyPnL=$${newDailyPnl.toFixed(2)} | AllTimePnL=$${newAllTimePnl.toFixed(2)}`;

    if (logger) logger.addLog(settlementLog);
    log(botId, settlementLog);

    await PineTradeState.findByIdAndUpdate((state as any)._id, {
        tradeOutcome: outcome,
        status: 'closed',
        exitPrice,
        pnl: netPnl,
        dailyPnl: newDailyPnl,
        allTimePnl: newAllTimePnl,
        cumulativeFees: (state.cumulativeFees ?? 0) + fees,
        allTimeFees: (state.allTimeFees ?? 0) + fees,
        lastTradeSettledAt: now,
    });

    // Push PnL update to Payload
    await syncPnlToPayload(c.id, newAllTimePnl, outcome).catch(() => {});

    return { state, isStillOpen: false };
}

/** Push PnL back to Payload CMS */
async function syncPnlToPayload(botId: string, allTimePnl: number, outcome: 'win' | 'loss'): Promise<void> {
    const { default: env } = await import('../config/env');
    const url = `${env.payloadUrl}/api/trading-bots/update-pnl`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, allTimePnl, lastTradeOutcome: outcome }),
        signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
}

/** Get or create an open trade state for the bot */
export async function getOrCreateState(c: PineBotConfig): Promise<IPineTradeState> {
    let state = await PineTradeState.findOne({ botId: c.id, status: 'open' });
    if (state) return state;

    // Get last closed state to inherit lifetime stats
    const last = await PineTradeState.findOne({ botId: c.id, status: 'closed' }).sort({ updatedAt: -1 });

    const now         = new Date();
    const isSameDay   = last && isSameUtcDay(last.updatedAt, now);
    const dailyPnl    = isSameDay ? (last?.dailyPnl ?? 0) : 0;
    const dailyLimit  = c.CAPITAL_AMOUNT * (c.DAILY_LOSS_LIMIT / 100);

    state = await PineTradeState.create({
        botId:             c.id,
        userId:            c.USER_ID,
        symbol:            c.SYMBOL,
        productId:         c.PRODUCT_ID,
        status:            'open',
        tradeOutcome:      'none',
        pnl:               0,
        dailyPnl,
        dailyLossLimitUSD: dailyLimit,
        allTimePnl:        last?.allTimePnl  ?? 0,
        allTimeFees:       last?.allTimeFees ?? 0,
        cumulativeFees:    0,
    });

    return state;
}

function isSameUtcDay(d1: Date | null | undefined, d2: Date): boolean {
    if (!d1) return false;
    return d1.getUTCFullYear() === d2.getUTCFullYear()
        && d1.getUTCMonth()    === d2.getUTCMonth()
        && d1.getUTCDate()     === d2.getUTCDate();
}
