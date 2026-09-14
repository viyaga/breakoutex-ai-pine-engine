// ================================================================
// BreakoutEx AI - Unified BrokerAdapter Interface
// Contract implemented by Zerodha, Angel One, Binance, Delta, Bybit
// ================================================================

import {
    AuthResult,
    BrokerProfile,
    Funds,
    Instrument,
    MarketTick,
    ModifyOrderRequest,
    Order,
    OrderResult,
    Position,
    Quote,
    UnifiedOrderRequest
} from './BrokerTypes';

export interface BrokerAdapter {
    // --- Session & Authentication ---
    authenticate(): Promise<AuthResult>;
    getProfile(): Promise<BrokerProfile>;
    getFunds(): Promise<Funds>;
    logout(): Promise<void>;

    // --- Positions & Orders ---
    getPositions(): Promise<Position[]>;
    getOrders(): Promise<Order[]>;
    placeOrder(request: UnifiedOrderRequest): Promise<OrderResult>;
    modifyOrder(orderId: string, request: ModifyOrderRequest): Promise<OrderResult>;
    cancelOrder(orderId: string): Promise<OrderResult>;

    // --- Market Data & Instruments ---
    getInstruments(exchange?: string): Promise<Instrument[]>;
    getQuotes(instruments: string[]): Promise<Quote[]>;
    subscribeMarketData(instruments: string[], callback: (tick: MarketTick) => void): Promise<void>;
    unsubscribeMarketData(instruments: string[]): Promise<void>;
}
