import mongoose, { Schema, Document } from 'mongoose';

// ── Trade State ──────────────────────────────────────────────────
export interface IPineTradeState {
    botId: string;
    userId: string;
    symbol: string;
    productId: number;
    status: 'open' | 'closed';
    tradeOutcome: 'pending' | 'win' | 'loss' | 'cancelled' | 'none';
    side?: 'buy' | 'sell' | null;
    entryOrderId?: string | null;
    stopLossOrderId?: string | null;
    takeProfitOrderId?: string | null;
    entryPrice?: number | null;
    slPrice?: number | null;
    tpPrice?: number | null;
    quantity?: number | null;
    leverage?: number | null;
    pnl: number;
    dailyPnl: number;
    dailyLossLimitUSD: number;
    allTimePnl: number;
    allTimeFees: number;
    cumulativeFees: number;
    exitPrice?: number | null;
    entryFilledAt?: Date | null;
    lastTradeSettledAt?: Date | null;
    updatedAt: Date;
    createdAt: Date;
}

const PineTradeStateSchema = new Schema<IPineTradeState>(
    {
        botId:             { type: String, required: true, index: true },
        userId:            { type: String, required: true, index: true },
        symbol:            { type: String, required: true },
        productId:         { type: Number },
        status:            { type: String, enum: ['open', 'closed'], default: 'open', index: true },
        tradeOutcome:      { type: String, enum: ['pending', 'win', 'loss', 'cancelled', 'none'], default: 'none' },
        side:              { type: String, enum: ['buy', 'sell', null], default: null },
        entryOrderId:      { type: String, default: null },
        stopLossOrderId:   { type: String, default: null },
        takeProfitOrderId: { type: String, default: null },
        entryPrice:        { type: Number, default: null },
        slPrice:           { type: Number, default: null },
        tpPrice:           { type: Number, default: null },
        quantity:          { type: Number, default: null },
        leverage:          { type: Number, default: null },
        pnl:               { type: Number, default: 0 },
        dailyPnl:          { type: Number, default: 0 },
        dailyLossLimitUSD: { type: Number, default: 0 },
        allTimePnl:        { type: Number, default: 0 },
        allTimeFees:       { type: Number, default: 0 },
        cumulativeFees:    { type: Number, default: 0 },
        exitPrice:         { type: Number, default: null },
        entryFilledAt:     { type: Date,   default: null },
        lastTradeSettledAt:{ type: Date,   default: null },
    },
    { timestamps: true }
);

PineTradeStateSchema.index({ botId: 1, status: 1 });
PineTradeStateSchema.index({ updatedAt: 1, botId: 1 });

export const PineTradeState = mongoose.model<IPineTradeState>('PineTradeState', PineTradeStateSchema);

// ── Bot Error ─────────────────────────────────────────────────────
const PineBotErrorSchema = new Schema({
    botId:     { type: String, required: true, unique: true, index: true },
    message:   { type: String, default: '' },
    isActive:  { type: Boolean },
    status:    { type: String },
    updatedAt: { type: Date, default: Date.now },
});

export const PineBotError = mongoose.model('PineBotError', PineBotErrorSchema);
