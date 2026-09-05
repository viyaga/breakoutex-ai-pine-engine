// ================================================================
// Unified Exchange Client Interface
// Standard contract implemented by Delta, Binance, Bybit, etc.
// ================================================================

import { Candle, OrderSide } from '../config/types';

export interface BracketOrderParams {
    productId: number | string;
    symbol: string;
    tpTrigger: number;
    tpLimit: number;
    slTrigger: number;
    positionSide: OrderSide;
    decimals: number;
}

export interface BracketOrderResult {
    success: boolean;
    tpId: string;
    slId: string;
}

export interface ExchangeOrderResult {
    result?: {
        id?: string;
        order_id?: string;
        average_fill_price?: number;
        limit_price?: number;
        state?: string;
        status?: string;
        side?: string;
        size?: number;
    };
    success?: boolean;
}

export interface ExchangePositionResult {
    size: number;
    entry_price?: number;
    side?: string;
    leverage?: number;
}

export interface IExchangeClient {
    setLogger?(logger: any, botId?: string): void;

    // Market Data
    getCandles(symbol: string, resolution: string, limitBars?: number): Promise<Candle[]>;
    getMarkPrice(symbol: string): Promise<number>;

    // Trading & Leverage
    setLeverage(productIdOrSymbol: number | string, leverage: number, symbol?: string): Promise<void>;
    placeMarketOrder(productIdOrSymbol: number | string, symbol: string, side: OrderSide, size: number): Promise<any>;
    placeBracketOrder(opts: BracketOrderParams): Promise<BracketOrderResult>;

    // Order & Position Management
    getOrder(id: string, symbol?: string): Promise<any>;
    getPosition(productIdOrSymbol: number | string, symbol?: string): Promise<any>;
    cancelAllOrders?(productIdOrSymbol: number | string, symbol?: string): Promise<void>;
}

/** Convert timeframe strings (1m, 5m, 1h, 1d) to duration in milliseconds */
export function resolutionMs(r: string): number {
    const clean = r.toLowerCase().trim();
    const val = parseInt(clean.replace(/[^0-9]/g, ''), 10) || 1;
    if (clean.includes('d')) return val * 86_400_000;
    if (clean.includes('h')) return val * 3_600_000;
    if (clean.includes('w')) return val * 604_800_000;
    return val * 60_000; // minutes
}
