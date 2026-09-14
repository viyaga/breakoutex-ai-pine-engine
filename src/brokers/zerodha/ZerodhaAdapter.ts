// ================================================================
// BreakoutEx AI - Zerodha Kite Connect v3 Broker Adapter
// Full implementation of BrokerAdapter for Indian Markets
// ================================================================

import { BrokerAdapter } from '../core/BrokerAdapter';
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
} from '../core/BrokerTypes';

const KITE_API_BASE = 'https://api.kite.trade';

export interface ZerodhaCredentials {
    apiKey: string;
    accessToken: string;
}

export class ZerodhaAdapter implements BrokerAdapter {
    private apiKey: string;
    private accessToken: string;
    private ws: any = null;
    private tickCallbacks: Set<(tick: MarketTick) => void> = new Set();
    private subscribedTokens: Set<number | string> = new Set();

    constructor(credentials: ZerodhaCredentials) {
        this.apiKey = credentials.apiKey;
        this.accessToken = credentials.accessToken;
    }

    private getHeaders() {
        return {
            'X-Kite-Version': '3',
            'Authorization': `token ${this.apiKey}:${this.accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        };
    }

    // --- Authentication & Profile ---

    public async authenticate(): Promise<AuthResult> {
        try {
            const profile = await this.getProfile();
            return {
                success: true,
                accessToken: this.accessToken,
                message: `Authenticated as ${profile.userName} (${profile.brokerClientId})`,
            };
        } catch (err: any) {
            return {
                success: false,
                message: err.message || 'Zerodha authentication failed',
            };
        }
    }

    public async getProfile(): Promise<BrokerProfile> {
        const res = await fetch(`${KITE_API_BASE}/user/profile`, {
            headers: this.getHeaders(),
        });
        const data: any = await res.json();
        if (data.status !== 'success') {
            throw new Error(data.message || 'Failed to fetch Zerodha profile');
        }

        const d = data.data;
        return {
            userId: d.user_id,
            userName: d.user_name,
            email: d.email,
            broker: 'zerodha',
            brokerClientId: d.user_id,
            exchanges: d.exchanges || ['NSE', 'NFO', 'BSE'],
        };
    }

    public async getFunds(): Promise<Funds> {
        const res = await fetch(`${KITE_API_BASE}/user/margins/equity`, {
            headers: this.getHeaders(),
        });
        const data: any = await res.json();
        if (data.status !== 'success') {
            throw new Error(data.message || 'Failed to fetch Zerodha funds');
        }

        const d = data.data;
        return {
            availableCash: d.available?.cash || 0,
            usedMargin: d.utilised?.debits || 0,
            totalCollateral: d.net || 0,
            currency: 'INR',
        };
    }

    public async logout(): Promise<void> {
        try {
            await fetch(`${KITE_API_BASE}/session/token`, {
                method: 'DELETE',
                headers: this.getHeaders(),
            });
        } finally {
            if (this.ws) {
                this.ws.close();
                this.ws = null;
            }
        }
    }

    // --- Positions & Orders ---

    public async getPositions(): Promise<Position[]> {
        const res = await fetch(`${KITE_API_BASE}/portfolio/positions`, {
            headers: this.getHeaders(),
        });
        const data: any = await res.json();
        if (data.status !== 'success') {
            throw new Error(data.message || 'Failed to fetch Zerodha positions');
        }

        const netPositions = data.data?.net || [];
        return netPositions.map((p: any): Position => ({
            symbol: p.tradingsymbol,
            exchange: p.exchange,
            productType: p.instrument_token ? 'options_buying' : 'futures',
            side: p.quantity >= 0 ? 'BUY' : 'SELL',
            quantity: Math.abs(p.quantity),
            averagePrice: p.average_price,
            currentPrice: p.last_price,
            unrealizedPnl: p.m2m,
            realizedPnl: p.pnl - p.m2m,
        }));
    }

    public async getOrders(): Promise<Order[]> {
        const res = await fetch(`${KITE_API_BASE}/orders`, {
            headers: this.getHeaders(),
        });
        const data: any = await res.json();
        if (data.status !== 'success') {
            throw new Error(data.message || 'Failed to fetch Zerodha orders');
        }

        return (data.data || []).map((o: any): Order => ({
            orderId: o.order_id,
            brokerOrderId: o.order_id,
            symbol: o.tradingsymbol,
            exchange: o.exchange,
            side: o.transaction_type === 'BUY' ? 'BUY' : 'SELL',
            quantity: o.quantity,
            price: o.price,
            status: this.mapOrderStatus(o.status),
            placedAt: new Date(o.order_timestamp).getTime(),
        }));
    }

    public async placeOrder(request: UnifiedOrderRequest): Promise<OrderResult> {
        const params = new URLSearchParams();
        params.append('exchange', request.exchange);
        params.append('tradingsymbol', request.symbol);
        params.append('transaction_type', request.side);
        params.append('order_type', this.mapOrderType(request.orderType));
        params.append('quantity', request.quantity.toString());
        params.append('product', 'NRML'); // NRML for overnight/delivery options, MIS for intraday
        params.append('validity', 'DAY');

        if (request.price && request.price > 0) {
            params.append('price', request.price.toString());
        }
        if (request.triggerPrice && request.triggerPrice > 0) {
            params.append('trigger_price', request.triggerPrice.toString());
        }
        if (request.tag) {
            params.append('tag', request.tag.slice(0, 8)); // Kite tags max 8 chars
        }

        const res = await fetch(`${KITE_API_BASE}/orders/regular`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: params.toString(),
        });

        const data: any = await res.json();
        if (data.status !== 'success') {
            return {
                success: false,
                orderId: request.orderId || `order_${Date.now()}`,
                status: 'REJECTED',
                message: data.message || 'Zerodha order placement failed',
                timestamp: Date.now(),
            };
        }

        return {
            success: true,
            orderId: request.orderId || data.data.order_id,
            brokerOrderId: data.data.order_id,
            status: 'SUBMITTED',
            message: 'Order placed successfully on Kite',
            timestamp: Date.now(),
        };
    }

    public async modifyOrder(orderId: string, request: ModifyOrderRequest): Promise<OrderResult> {
        const params = new URLSearchParams();
        if (request.price) params.append('price', request.price.toString());
        if (request.triggerPrice) params.append('trigger_price', request.triggerPrice.toString());
        if (request.quantity) params.append('quantity', request.quantity.toString());

        const res = await fetch(`${KITE_API_BASE}/orders/regular/${orderId}`, {
            method: 'PUT',
            headers: this.getHeaders(),
            body: params.toString(),
        });

        const data: any = await res.json();
        return {
            success: data.status === 'success',
            orderId,
            brokerOrderId: orderId,
            status: data.status === 'success' ? 'SUBMITTED' : 'REJECTED',
            message: data.message,
            timestamp: Date.now(),
        };
    }

    public async cancelOrder(orderId: string): Promise<OrderResult> {
        const res = await fetch(`${KITE_API_BASE}/orders/regular/${orderId}`, {
            method: 'DELETE',
            headers: this.getHeaders(),
        });

        const data: any = await res.json();
        return {
            success: data.status === 'success',
            orderId,
            brokerOrderId: orderId,
            status: data.status === 'success' ? 'CANCELLED' : 'REJECTED',
            message: data.message,
            timestamp: Date.now(),
        };
    }

    // --- Market Data & Instruments ---

    public async getInstruments(exchange: string = 'NFO'): Promise<Instrument[]> {
        const res = await fetch(`${KITE_API_BASE}/instruments/${exchange.toLowerCase()}`, {
            headers: this.getHeaders(),
        });
        const text = await res.text();
        return this.parseKiteCsv(text, exchange as any);
    }

    public async getQuotes(instruments: string[]): Promise<Quote[]> {
        const query = instruments.map(i => `i=${encodeURIComponent(i)}`).join('&');
        const res = await fetch(`${KITE_API_BASE}/quote?${query}`, {
            headers: this.getHeaders(),
        });
        const data: any = await res.json();
        if (data.status !== 'success') {
            throw new Error(data.message || 'Failed to fetch quotes');
        }

        const quotes: Quote[] = [];
        for (const [key, val] of Object.entries(data.data as Record<string, any>)) {
            quotes.push({
                symbol: key,
                ltp: val.last_price,
                open: val.ohlc?.open || 0,
                high: val.ohlc?.high || 0,
                low: val.ohlc?.low || 0,
                close: val.ohlc?.close || 0,
                volume: val.volume || 0,
                bid: val.depth?.buy?.[0]?.price,
                ask: val.depth?.sell?.[0]?.price,
            });
        }
        return quotes;
    }

    public async subscribeMarketData(instruments: string[], callback: (tick: MarketTick) => void): Promise<void> {
        this.tickCallbacks.add(callback);
        for (const inst of instruments) {
            this.subscribedTokens.add(inst);
        }
        // If WebSocket is active, send subscribe packet
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({ a: 'subscribe', v: Array.from(this.subscribedTokens) }));
        }
    }

    public async unsubscribeMarketData(instruments: string[]): Promise<void> {
        for (const inst of instruments) {
            this.subscribedTokens.delete(inst);
        }
        if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({ a: 'unsubscribe', v: instruments }));
        }
    }

    // --- Helper Parsers & Mappers ---

    private parseKiteCsv(csvText: string, exchange: 'NFO' | 'NSE' | 'BSE' | 'CRYPTO'): Instrument[] {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const tokenIdx = headers.indexOf('instrument_token');
        const symbolIdx = headers.indexOf('tradingsymbol');
        const nameIdx = headers.indexOf('name');
        const expiryIdx = headers.indexOf('expiry');
        const strikeIdx = headers.indexOf('strike');
        const typeIdx = headers.indexOf('instrument_type');
        const lotSizeIdx = headers.indexOf('lot_size');
        const tickSizeIdx = headers.indexOf('tick_size');

        const instruments: Instrument[] = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
            if (!cols[symbolIdx]) continue;

            const optType = cols[typeIdx];
            instruments.push({
                exchange,
                instrumentToken: cols[tokenIdx],
                tradingsymbol: cols[symbolIdx],
                underlying: cols[nameIdx] || cols[symbolIdx],
                expiry: cols[expiryIdx] || undefined,
                strike: cols[strikeIdx] ? parseFloat(cols[strikeIdx]) : undefined,
                optionType: (optType === 'CE' || optType === 'PE' || optType === 'FUT') ? optType : 'SPOT',
                lotSize: cols[lotSizeIdx] ? parseInt(cols[lotSizeIdx], 10) : 1, // Dynamically parsed from CSV
                tickSize: cols[tickSizeIdx] ? parseFloat(cols[tickSizeIdx]) : 0.05,
            });
        }
        return instruments;
    }

    private mapOrderStatus(status: string): Order['status'] {
        const s = (status || '').toUpperCase();
        if (s === 'COMPLETE') return 'FILLED';
        if (s === 'REJECTED') return 'REJECTED';
        if (s === 'CANCELLED') return 'CANCELLED';
        if (s === 'OPEN' || s === 'TRIGGER PENDING') return 'SUBMITTED';
        return 'PENDING';
    }

    private mapOrderType(orderType: string): string {
        switch (orderType) {
            case 'MARKET': return 'MARKET';
            case 'LIMIT': return 'LIMIT';
            case 'SL': return 'SL';
            case 'SL_M': return 'SL-M';
            default: return 'MARKET';
        }
    }
}
