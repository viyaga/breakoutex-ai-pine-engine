// ================================================================
// BreakoutEx AI - Multi-Market Broker & Trading Types
// Unified types supporting Indian Stock Brokers & Crypto Exchanges
// ================================================================

export type BrokerType = 'zerodha' | 'angelone' | 'binance' | 'delta' | 'bybit';
export type MarketType = 'indian_stock' | 'crypto';
export type CountryCode = 'IN' | 'US' | 'AE' | 'SG' | 'GB' | 'OTHER';

export type ProductType = 
    | 'options_buying'  // Indian Options Buying (V1: CE, PE, AI Directional)
    | 'futures'         // Equity/Index Futures & Crypto Futures
    | 'spot'            // Spot Trading
    | 'crypto_perp';    // Crypto Perpetual Swaps

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'SL' | 'SL_M';
export type OrderStatus = 'PENDING' | 'SUBMITTED' | 'FILLED' | 'REJECTED' | 'CANCELLED';

export interface BrokerAccount {
    id: string;
    userId: string;
    broker: BrokerType;
    accountName: string;
    status: 'connected' | 'session_expired' | 'error';
    country: CountryCode;
    capabilities: ProductType[];
    lastSyncedAt: string;
}

export interface Instrument {
    exchange: 'NFO' | 'NSE' | 'BSE' | 'CRYPTO';
    instrumentToken: number | string;
    tradingsymbol: string;
    underlying: string;
    expiry?: string;              // ISO Date string (e.g. '2026-09-24')
    strike?: number;
    optionType?: 'CE' | 'PE' | 'FUT' | 'SPOT';
    lotSize: number;             // Dynamically loaded from broker/exchange master (never hardcoded)
    tickSize: number;
    freezeQuantity?: number;     // Maximum quantity allowed per order
}

export interface MarketTick {
    instrumentId: string;
    exchange: string;
    timestamp: number;
    ltp: number;
    bid?: number;
    ask?: number;
    volume?: number;
    openInterest?: number;
}

export interface UnifiedOrderRequest {
    orderId?: string;
    userId: string;
    broker: BrokerType;
    brokerAccountId: string;
    exchange: 'NFO' | 'NSE' | 'BSE' | 'CRYPTO';
    symbol: string;              // tradingsymbol (e.g. 'NIFTY2691924850CE' or 'BTCUSDT')
    productType: ProductType;
    side: OrderSide;
    quantity: number;
    orderType: OrderType;
    price?: number;
    triggerPrice?: number;
    strategyId: string;
    botId: string;
    tag?: string;                // Regulatory compliance tag (e.g. 'BX_ALGO_01')
}

export interface ModifyOrderRequest {
    orderId: string;
    price?: number;
    triggerPrice?: number;
    quantity?: number;
}

export interface OrderResult {
    success: boolean;
    orderId: string;
    brokerOrderId?: string;
    averagePrice?: number;
    filledQuantity?: number;
    status: OrderStatus;
    message?: string;
    timestamp: number;
}

export interface BrokerProfile {
    userId: string;
    userName: string;
    email?: string;
    broker: BrokerType;
    brokerClientId: string;
    exchanges: string[];
}

export interface Funds {
    availableCash: number;
    usedMargin: number;
    totalCollateral: number;
    currency: 'INR' | 'USD';
}

export interface Position {
    symbol: string;
    exchange: string;
    productType: ProductType;
    side: OrderSide;
    quantity: number;
    averagePrice: number;
    currentPrice: number;
    unrealizedPnl: number;
    realizedPnl: number;
}

export interface Order {
    orderId: string;
    brokerOrderId?: string;
    symbol: string;
    exchange: string;
    side: OrderSide;
    quantity: number;
    price?: number;
    status: OrderStatus;
    placedAt: number;
}

export interface Quote {
    symbol: string;
    ltp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    bid?: number;
    ask?: number;
}

export interface AuthResult {
    success: boolean;
    accessToken?: string;
    expiresAt?: number;
    message?: string;
}
