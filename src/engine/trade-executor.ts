// ================================================================
// Trade Executor — places entry + TP/SL bracket orders
// Smart resolution for absolute prices vs point offsets
// ================================================================

import { IExchangeClient } from '../exchange/exchange.interface';
import { PineTradeState, PineBotError } from '../models/tradeState.model';
import { PineBotConfig, OrderSide } from '../config/types';

function log(botId: string, msg: string) { console.log(`[TradeExec][${botId}] ${msg}`); }

function clampDecimals(v: number, dec: number): number {
    const factor = Math.pow(10, dec);
    return Math.round(v * factor) / factor;
}

/**
 * Resolves TP/SL prices whether user provided:
 * 1. Absolute price (e.g. limit=52000, stop=48000)
 * 2. Point / Dollar offset (e.g. profit=300, loss=120)
 * 3. Percentage fallback from bot configuration (e.g. TP=1.5%, SL=0.8%)
 */
export function computeTPSL(
    entryPrice: number,
    side: OrderSide,
    c: PineBotConfig,
    signalTp?: number,
    signalSl?: number
): { tp: number; sl: number; tpLimit: number; slBuf: number } {
    const tpPercent = c.TP_PERCENT / 100;
    const slPercent = c.SL_PERCENT / 100;
    const dec       = c.PRICE_DECIMAL_PLACES;

    let tpTrigger: number;
    let slTrigger: number;

    // ── 1. Resolve Take Profit ────────────────────────────────────
    if (signalTp && signalTp > 0) {
        // If signalTp is near entry price (within 50% to 200%), treat as absolute price
        if (signalTp > entryPrice * 0.3 && signalTp < entryPrice * 3.0) {
            tpTrigger = signalTp;
        } else {
            // Treat as point / dollar distance offset from entry
            tpTrigger = side === 'buy'
                ? entryPrice + signalTp
                : entryPrice - signalTp;
        }
    } else {
        tpTrigger = side === 'buy'
            ? entryPrice * (1 + tpPercent)
            : entryPrice * (1 - tpPercent);
    }

    // ── 2. Resolve Stop Loss ──────────────────────────────────────
    if (signalSl && signalSl > 0) {
        // If signalSl is near entry price, treat as absolute price
        if (signalSl > entryPrice * 0.3 && signalSl < entryPrice * 3.0) {
            slTrigger = signalSl;
        } else {
            // Treat as point / dollar distance offset from entry
            slTrigger = side === 'buy'
                ? entryPrice - signalSl
                : entryPrice + signalSl;
        }
    } else {
        slTrigger = side === 'buy'
            ? entryPrice * (1 - slPercent)
            : entryPrice * (1 + slPercent);
    }

    // Safety clamp: Ensure TP is always above entry for BUY, below entry for SELL
    if (side === 'buy' && tpTrigger <= entryPrice) {
        tpTrigger = entryPrice * (1 + tpPercent);
    } else if (side === 'sell' && tpTrigger >= entryPrice) {
        tpTrigger = entryPrice * (1 - tpPercent);
    }

    // Safety clamp: Ensure SL is always below entry for BUY, above entry for SELL
    if (side === 'buy' && slTrigger >= entryPrice) {
        slTrigger = entryPrice * (1 - slPercent);
    } else if (side === 'sell' && slTrigger <= entryPrice) {
        slTrigger = entryPrice * (1 + slPercent);
    }

    // ── Enforce Minimum Risk-to-Reward Ratio (minRR) ───────────────
    const minRR = Math.max(1.0, c.MIN_RR || 1.5);
    const slDist = Math.abs(entryPrice - slTrigger);
    const requiredTpDist = slDist * minRR;
    const currentTpDist = Math.abs(tpTrigger - entryPrice);

    if (currentTpDist < requiredTpDist) {
        tpTrigger = side === 'buy'
            ? entryPrice + requiredTpDist
            : entryPrice - requiredTpDist;
    }

    tpTrigger = clampDecimals(tpTrigger, dec);
    slTrigger = clampDecimals(slTrigger, dec);

    // ── 3. Bracket Order Limit & Trigger Buffers ──────────────────
    const tpBuf   = (c.TP_LIMIT_BUFFER_PERCENT / 100);
    const tpLimit = side === 'buy'
        ? clampDecimals(tpTrigger * (1 - tpBuf), dec)
        : clampDecimals(tpTrigger * (1 + tpBuf), dec);

    const slBuf  = (c.SL_TRIGGER_BUFFER_PERCENT / 100);
    const slTriggerAdj = side === 'buy'
        ? clampDecimals(slTrigger * (1 - slBuf), dec)
        : clampDecimals(slTrigger * (1 + slBuf), dec);

    return { tp: tpTrigger, sl: slTriggerAdj, tpLimit, slBuf };
}

export async function executeTrade(
    client: IExchangeClient,
    c: PineBotConfig,
    side: OrderSide,
    state: any,
    signalTp?: number,
    signalSl?: number,
    logger?: { addLog: (msg: string) => void }
): Promise<void> {
    const botId = c.id;

    // ── Compute quantity in lots according to MODE ────────────────
    const markPrice = await client.getMarkPrice(c.SYMBOL);
    if (!markPrice) throw new Error('Cannot fetch mark price');

    let tradeUSD: number;
    if (c.MODE === 'safe') {
        tradeUSD = Math.min(c.MIN_TRADE_SIZE, c.MAX_TRADE_SIZE);
    } else if (c.MODE === 'aggressive') {
        tradeUSD = Math.max(c.MIN_TRADE_SIZE, c.MAX_TRADE_SIZE);
    } else { // balanced
        tradeUSD = (c.MIN_TRADE_SIZE + c.MAX_TRADE_SIZE) / 2;
    }

    const notional   = tradeUSD * c.LEVERAGE;
    const qty        = Math.max(1, Math.floor(notional / (markPrice * (c.LOT_SIZE || 1))));
    const maxQty     = Math.max(1, Math.floor((Math.max(c.MIN_TRADE_SIZE, c.MAX_TRADE_SIZE) * c.LEVERAGE) / (markPrice * (c.LOT_SIZE || 1))));

    if (qty > maxQty) {
        const capMsg = `Qty ${qty} exceeds maxQty ${maxQty}. Capping.`;
        if (logger) logger.addLog(capMsg);
        log(botId, capMsg);
    }
    const finalQty = Math.min(qty, maxQty);

    if (finalQty <= 0) throw new Error('Calculated quantity is 0');

    const entryPrepMsg = `Placing ${side.toUpperCase()} entry — qty=${finalQty} lots, expected price≈$${markPrice.toFixed(2)}`;
    if (logger) logger.addLog(entryPrepMsg);
    log(botId, entryPrepMsg);

    if (c.DRY_RUN) {
        const dryMsg = '[DRY RUN] Skipping actual order placement';
        if (logger) logger.addLog(dryMsg);
        log(botId, dryMsg);
        return;
    }

    // ── Entry order ───────────────────────────────────────────────
    const prodIdentifier = c.PRODUCT_ID || c.SYMBOL;
    const entryRes = await client.placeMarketOrder(prodIdentifier, c.SYMBOL, side, finalQty);
    const entryId  = String(entryRes?.result?.id || entryRes?.result?.order_id || '');
    if (!entryId) throw new Error('Entry order did not return an ID');

    const fillPrice = Number(entryRes?.result?.average_fill_price ?? markPrice);

    // Calculate slippage
    const rawSlippagePct = side === 'buy'
        ? ((fillPrice - markPrice) / markPrice) * 100
        : ((markPrice - fillPrice) / markPrice) * 100;
    const slippageBps = Math.round(rawSlippagePct * 100);

    const fillMsg = `Entry Order Filled: ID=${entryId} | FillPrice=$${fillPrice.toFixed(2)} (Expected Mark=$${markPrice.toFixed(2)} | Slippage=${slippageBps > 0 ? '+' : ''}${slippageBps} bps / ${rawSlippagePct.toFixed(3)}%)`;
    if (logger) logger.addLog(fillMsg);
    log(botId, fillMsg);

    // ── Compute TP / SL ───────────────────────────────────────────
    const { tp, sl, tpLimit } = computeTPSL(fillPrice, side, c, signalTp, signalSl);

    const tpDistPct = Math.abs((tp - fillPrice) / fillPrice) * 100;
    const slDistPct = Math.abs((fillPrice - sl) / fillPrice) * 100;
    const effectiveRR = slDistPct > 0 ? Number((tpDistPct / slDistPct).toFixed(2)) : 1.5;

    const tpslMsg = `Computed Brackets: TP=$${tp.toFixed(2)} (+${tpDistPct.toFixed(2)}%) [Limit=$${tpLimit.toFixed(2)}] | SL=$${sl.toFixed(2)} (-${slDistPct.toFixed(2)}%) | Effective R:R=${effectiveRR}:1`;
    if (logger) logger.addLog(tpslMsg);
    log(botId, tpslMsg);

    // ── Bracket order ─────────────────────────────────────────────
    const bracket = await client.placeBracketOrder({
        productId:    prodIdentifier,
        symbol:       c.SYMBOL,
        tpTrigger:    tp,
        tpLimit:      tpLimit,
        slTrigger:    sl,
        positionSide: side,
        decimals:     c.PRICE_DECIMAL_PLACES,
    });

    if (!bracket.success) throw new Error('Failed to place TP/SL bracket orders');

    const bracketMsg = `Bracket Orders Placed on Exchange: TP_ID=${bracket.tpId} | SL_ID=${bracket.slId}`;
    if (logger) logger.addLog(bracketMsg);
    log(botId, bracketMsg);

    // ── Save state ────────────────────────────────────────────────
    await PineTradeState.findByIdAndUpdate(state._id, {
        tradeOutcome:      'pending',
        side,
        entryOrderId:       entryId,
        takeProfitOrderId:  bracket.tpId,
        stopLossOrderId:    bracket.slId,
        entryPrice:         fillPrice,
        tpPrice:            tp,
        slPrice:            sl,
        quantity:           finalQty,
        leverage:           c.LEVERAGE,
        entryFilledAt:      new Date(),
        lastTradeSettledAt: new Date(),
    });

    // Clear any lingering bot error
    await PineBotError.findOneAndUpdate(
        { botId },
        { message: '', status: 'active', isActive: true, updatedAt: new Date() },
        { upsert: true }
    );

    const actualNotional = finalQty * (c.LOT_SIZE || 1) * fillPrice;
    const completeMsg = `✓ TRADE COMPLETE — ${side.toUpperCase()} ${finalQty}L ($${actualNotional.toFixed(2)} Notional) @$${fillPrice.toFixed(2)} | TP=$${tp.toFixed(2)} SL=$${sl.toFixed(2)} | R:R=${effectiveRR}:1`;
    if (logger) logger.addLog(completeMsg);
    log(botId, completeMsg);
}
