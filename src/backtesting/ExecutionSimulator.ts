// ================================================================
// BreakoutEx AI — Realistic Order Execution & Friction Engine
//
// Models exchange order filling, market vs limit fees, bid/ask spread,
// volatility-scaled slippage, gap-through stop-loss fills, lot/tick precision,
// perpetual funding costs, and liquidation mechanics.
// ================================================================

import { Candle } from '../config/types';
import { TradeSide } from './types';
import { ExchangeContractSpec } from './ExchangeConfig';

export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_MARKET';

export interface FillRequest {
    orderType: OrderType;
    side: TradeSide;
    requestedPrice: number;
    requestedQuantity: number;
    candle: Candle;
    atrRatio?: number; // ATR / Avg ATR (for volatility-scaled slippage)
    isExit?: boolean;
    isStopLoss?: boolean;
}

export interface ExecutionFillResult {
    executedPrice: number;
    executedQuantity: number;
    notionalValue: number;
    feePaid: number;
    feeType: 'MAKER' | 'TAKER';
    slippagePaid: number;
    slippagePercent: number;
    spreadPaid: number;
    gapLossPaid: number;
}

export class ExecutionSimulator {

    /**
     * Round price to the nearest exchange tick precision.
     */
    static roundPriceToTick(price: number, tickSize: number): number {
        if (!tickSize || tickSize <= 0) return price;
        const precision = Math.max(0, Math.round(-Math.log10(tickSize)));
        const rounded = Math.round(price / tickSize) * tickSize;
        return Number(rounded.toFixed(precision));
    }

    /**
     * Round quantity to the nearest exchange lot step size and enforce minQty.
     */
    static roundQtyToStep(qty: number, stepSize: number, minQty: number): number {
        if (qty < minQty) return 0;
        if (!stepSize || stepSize <= 0) return qty;
        const precision = Math.max(0, Math.round(-Math.log10(stepSize)));
        const rounded = Math.floor(qty / stepSize) * stepSize;
        return Number(rounded.toFixed(precision));
    }

    /**
     * Simulate realistic order execution with fee, spread, slippage, and gap modeling.
     */
    static executeOrder(request: FillRequest, spec: ExchangeContractSpec): ExecutionFillResult {
        const isLong = request.side === 'long';
        const rawPrice = request.requestedPrice;
        const candle = request.candle;
        const atrMult = Math.max(1.0, request.atrRatio || 1.0);

        // 1. Quantity Precision & Min Notional Check
        let qty = ExecutionSimulator.roundQtyToStep(request.requestedQuantity, spec.stepSize, spec.minQty);
        let notional = qty * rawPrice;

        if (notional < spec.minNotional) {
            // Adjust to minimum notional if allowed
            qty = ExecutionSimulator.roundQtyToStep((spec.minNotional * 1.05) / rawPrice, spec.stepSize, spec.minQty);
            notional = qty * rawPrice;
        }

        let execPrice = rawPrice;
        let feeRate = spec.takerFeePercent / 100;
        let feeType: 'MAKER' | 'TAKER' = 'TAKER';
        let slippagePct = 0;
        let spreadPaid = 0;
        let gapLossPaid = 0;

        // 2. Pricing Logic by Order Type
        if (request.orderType === 'LIMIT' && !request.isStopLoss) {
            // Limit Order (TP or Limit Entry) -> Maker Fee & Zero Slippage (or better fill on gap open)
            feeType = 'MAKER';
            feeRate = spec.makerFeePercent / 100;

            if (isLong) {
                // Buy Limit: Fills at limit price or open price if gap down
                execPrice = Math.min(rawPrice, candle.open < rawPrice ? candle.open : rawPrice);
            } else {
                // Sell Limit: Fills at limit price or open price if gap up
                execPrice = Math.max(rawPrice, candle.open > rawPrice ? candle.open : rawPrice);
            }
        } else if (request.isStopLoss) {
            // Stop Loss Fill (Market execution on gap down / volatility spike)
            feeType = 'TAKER';
            feeRate = spec.takerFeePercent / 100;

            // Gap-through Stop Loss Modeling
            if (isLong) {
                // Long SL triggered: If candle open is below SL or low is below SL
                if (candle.open < rawPrice) {
                    // Heavy gap down through SL on open
                    const gap = rawPrice - candle.open;
                    gapLossPaid = gap * qty;
                    execPrice = candle.open;
                } else if (candle.low < rawPrice) {
                    // Intrabar slippage past SL
                    const slipDist = (rawPrice - candle.low) * 0.25 * spec.stopLossGapSlippageMultiplier;
                    execPrice = Math.max(candle.low, rawPrice - slipDist);
                } else {
                    execPrice = rawPrice;
                }
            } else {
                // Short SL triggered: If candle open is above SL or high is above SL
                if (candle.open > rawPrice) {
                    const gap = candle.open - rawPrice;
                    gapLossPaid = gap * qty;
                    execPrice = candle.open;
                } else if (candle.high > rawPrice) {
                    const slipDist = (candle.high - rawPrice) * 0.25 * spec.stopLossGapSlippageMultiplier;
                    execPrice = Math.min(candle.high, rawPrice + slipDist);
                } else {
                    execPrice = rawPrice;
                }
            }
        } else {
            // Market Order Entry / Exit -> Taker Fee + Half-Spread + Volatility Slippage
            feeType = 'TAKER';
            feeRate = spec.takerFeePercent / 100;

            const halfSpreadPct = (spec.bidAskSpreadPercent / 2) / 100;
            const baseSlipPct = (spec.baseSlippagePercent / 100) * (spec.slippageModel === 'VOLATILITY_SCALED' ? Math.sqrt(atrMult) : 1.0);

            slippagePct = baseSlipPct;
            spreadPaid = rawPrice * halfSpreadPct * qty;

            if (isLong) {
                execPrice = rawPrice * (1 + halfSpreadPct + baseSlipPct);
            } else {
                execPrice = rawPrice * (1 - halfSpreadPct - baseSlipPct);
            }
        }

        // Apply Tick Size Precision Rounding
        execPrice = ExecutionSimulator.roundPriceToTick(execPrice, spec.tickSize);
        const finalNotional = qty * execPrice;
        const feePaid = finalNotional * feeRate;
        const slippagePaid = Math.abs(execPrice - rawPrice) * qty;

        return {
            executedPrice: execPrice,
            executedQuantity: qty,
            notionalValue: Number(finalNotional.toFixed(2)),
            feePaid: Number(feePaid.toFixed(2)),
            feeType,
            slippagePaid: Number(slippagePaid.toFixed(2)),
            slippagePercent: Number((slippagePct * 100).toFixed(4)),
            spreadPaid: Number(spreadPaid.toFixed(2)),
            gapLossPaid: Number(gapLossPaid.toFixed(2)),
        };
    }

    /**
     * Calculate 8-hour perpetual funding costs/credits based on position size and holding duration.
     */
    static calculateFundingCost(
        notionalValue: number,
        side: TradeSide,
        holdingTimeMinutes: number,
        fundingRate8hPercent: number
    ): number {
        if (!fundingRate8hPercent || holdingTimeMinutes < 480) return 0;
        const fundingPeriods = Math.floor(holdingTimeMinutes / 480);
        const ratePerPeriod = (fundingRate8hPercent / 100);

        // Long positions pay positive funding rate; Short positions receive it
        const sign = side === 'long' ? 1 : -1;
        const cost = notionalValue * ratePerPeriod * fundingPeriods * sign;
        return Number(cost.toFixed(2));
    }

    /**
     * Check if a position was liquidated due to price breaching maintenance margin.
     */
    static checkLiquidation(
        entryPrice: number,
        side: TradeSide,
        leverage: number,
        maintenanceMarginPct: number,
        candleHigh: number,
        candleLow: number
    ): { isLiquidated: boolean; liquidationPrice: number } {
        if (!leverage || leverage <= 1) return { isLiquidated: false, liquidationPrice: 0 };

        const mm = (maintenanceMarginPct || 0.5) / 100;
        const isLong = side === 'long';

        // Liquidation Price calculation:
        // Long Liq Price = Entry * (1 - (1/Leverage) + MM)
        // Short Liq Price = Entry * (1 + (1/Leverage) - MM)
        let liqPrice = 0;
        let isLiquidated = false;

        if (isLong) {
            liqPrice = entryPrice * (1 - (1 / leverage) + mm);
            if (candleLow <= liqPrice) {
                isLiquidated = true;
            }
        } else {
            liqPrice = entryPrice * (1 + (1 / leverage) - mm);
            if (candleHigh >= liqPrice) {
                isLiquidated = true;
            }
        }

        return {
            isLiquidated,
            liquidationPrice: Number(liqPrice.toFixed(2)),
        };
    }
}
