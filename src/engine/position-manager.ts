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

/** Sync leverage on the exchange, silently handles errors */
export async function syncLeverage(client: IExchangeClient, c: PineBotConfig): Promise<void> {
    try {
        const prodIdentifier = c.PRODUCT_ID || c.SYMBOL;
        await client.setLeverage(prodIdentifier, c.LEVERAGE, c.SYMBOL);
    } catch (err: any) {
        console.warn(`[PineEngine][${c.id}] Leverage sync failed (non-fatal): ${err.message}`);
    }
}

/**
 * Check and update a PENDING trade.
 * Returns updated state. Marks state closed if trade resolved.
 */
export async function handleOpenTrade(
    client: IExchangeClient,
    state: IPineTradeState,
    c: PineBotConfig
): Promise<{ state: IPineTradeState; isStillOpen: boolean }> {
    const botId = c.id;

    if (!state.entryOrderId) return { state, isStillOpen: false };

    // 1. Get entry order status
    const entryOrder = await client.getOrder(state.entryOrderId, c.SYMBOL);
    if (!entryOrder) {
        log(botId, `Could not fetch entry order ${state.entryOrderId}`);
        return { state, isStillOpen: true };
    }

    const entryStatus = (entryOrder.state ?? entryOrder.status ?? '').toUpperCase();
    log(botId, `Entry order ${state.entryOrderId} status: ${entryStatus}`);

    // If entry not filled yet, wait
    if (entryStatus === 'OPEN' || entryStatus === 'PENDING') {
        return { state, isStillOpen: true };
    }

    // If entry cancelled/failed, reset state
    if (entryStatus === 'CANCELLED') {
        log(botId, 'Entry order cancelled. Resetting state.');
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


    // Compute PnL
    const qty  = Number(state.quantity ?? 0);
    const lot  = c.LOT_SIZE || 1;
    const side = state.side ?? 'buy';

    const rawPnl = side === 'buy'
        ? (exitPrice - entryPrice) * qty * lot
        : (entryPrice - exitPrice) * qty * lot;

    const feePercent = c.ESTIMATED_FEE_PERCENT / 100;
    const fees = entryPrice * qty * lot * feePercent * 2;
    const netPnl = rawPnl - fees;

    const newAllTimePnl = (state.allTimePnl ?? 0) + netPnl;
    const newDailyPnl   = (state.dailyPnl   ?? 0) + netPnl;

    log(botId, `Trade closed: outcome=${outcome} exitPrice=${exitPrice} pnl=${netPnl.toFixed(2)}`);

    await PineTradeState.findByIdAndUpdate((state as any)._id, {
        tradeOutcome: outcome,
        status: 'closed',
        exitPrice,
        pnl: netPnl,
        dailyPnl: newDailyPnl,
        allTimePnl: newAllTimePnl,
        cumulativeFees: (state.cumulativeFees ?? 0) + fees,
        allTimeFees: (state.allTimeFees ?? 0) + fees,
        lastTradeSettledAt: new Date(),
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
