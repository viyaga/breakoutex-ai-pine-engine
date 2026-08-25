// ================================================================
// Binance Futures (USDT-M) HTTP Client
// HMAC-SHA256 authenticated client implementing IExchangeClient
// ================================================================

import crypto from 'crypto';
import { Candle, OrderSide } from '../config/types';
import { IExchangeClient, BracketOrderParams, BracketOrderResult } from './exchange.interface';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export class BinanceClient implements IExchangeClient {
    private timeOffset = 0;

    constructor(
        private readonly apiKey: string,
        private readonly secretKey: string,
        private readonly baseUrl: string = 'https://fapi.binance.com',
    ) {}

    private sign(queryString: string): string {
        return crypto.createHmac('sha256', this.secretKey)
            .update(queryString)
            .digest('hex');
    }

    private normalizeSymbol(s: string): string {
        return s.toUpperCase().replace(/[-/_]/g, '');
    }

    private normalizeInterval(resolution: string): string {
        const r = resolution.toLowerCase().trim();
        if (r === '1' || r === '1m') return '1m';
        if (r === '3' || r === '3m') return '3m';
        if (r === '5' || r === '5m') return '5m';
        if (r === '15' || r === '15m') return '15m';
        if (r === '30' || r === '30m') return '30m';
        if (r === '60' || r === '1h' || r === '60m') return '1h';
        if (r === '120' || r === '2h' || r === '120m') return '2h';
        if (r === '240' || r === '4h' || r === '240m') return '4h';
        if (r === 'd' || r === '1d' || r === '1440') return '1d';
        if (r === 'w' || r === '1w') return '1w';
        return '5m';
    }

    private async request(method: string, endpoint: string, params: Record<string, any> = {}, isPublic = false): Promise<any> {
        const maxAttempts = isPublic ? 2 : 3;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const searchParams = new URLSearchParams();
                for (const [key, value] of Object.entries(params)) {
                    if (value !== undefined && value !== null) {
                        searchParams.append(key, String(value));
                    }
                }

                if (!isPublic) {
                    const ts = Date.now() + this.timeOffset;
                    searchParams.append('timestamp', String(ts));
                    searchParams.append('recvWindow', '10000');
                    const signature = this.sign(searchParams.toString());
                    searchParams.append('signature', signature);
                }

                const qs = searchParams.toString() ? `?${searchParams.toString()}` : '';
                const url = `${this.baseUrl}${endpoint}${qs}`;

                const headers: Record<string, string> = {
                    Accept: 'application/json',
                };
                if (!isPublic && this.apiKey) {
                    headers['X-MBX-APIKEY'] = this.apiKey;
                }

                const res = await fetch(url, {
                    method,
                    headers,
                    signal: AbortSignal.timeout(15_000),
                });

                const text = await res.text();
                let json: any;
                try { json = JSON.parse(text); } catch { json = text; }

                if (!res.ok) {
                    // Check for timestamp synchronization issues (-1021)
                    if (json?.code === -1021 && !isPublic && attempt < maxAttempts) {
                        const timeRes = await fetch(`${this.baseUrl}/fapi/v1/time`).catch(() => null);
                        const timeData = (await timeRes?.json().catch(() => null)) as any;
                        if (timeData?.serverTime) {
                            this.timeOffset = Number(timeData.serverTime) - Date.now();
                            console.warn(`[Binance] Adjusted timeOffset to ${this.timeOffset}ms`);
                            continue;
                        }
                    }

                    throw new Error(`Binance API ${res.status}: ${JSON.stringify(json)}`);
                }

                return json;
            } catch (err: any) {
                if (attempt === maxAttempts) throw err;
                await sleep(attempt * 1000);
            }
        }
    }

    // ── Market Data ─────────────────────────────────────────────
    async getCandles(symbol: string, resolution: string, limitBars = 100): Promise<Candle[]> {
        const cleanSym = this.normalizeSymbol(symbol);
        const interval = this.normalizeInterval(resolution);

        const raw = await this.request('GET', '/fapi/v1/klines', {
            symbol: cleanSym,
            interval,
            limit: Math.min(1000, Math.max(20, limitBars + 5)),
        }, true);

        if (!Array.isArray(raw)) return [];

        return raw.map((k: any[]) => ({
            timestamp: Number(k[0]),
            open:   Number(k[1]),
            high:   Number(k[2]),
            low:    Number(k[3]),
            close:  Number(k[4]),
            volume: Number(k[5]),
        })).sort((a, b) => a.timestamp - b.timestamp);
    }

    async getMarkPrice(symbol: string): Promise<number> {
        const cleanSym = this.normalizeSymbol(symbol);
        const res = await this.request('GET', '/fapi/v1/premiumIndex', { symbol: cleanSym }, true);
        return Number(res?.markPrice ?? res?.lastPrice ?? 0);
    }

    // ── Trading & Leverage ──────────────────────────────────────
    async setLeverage(_productIdOrSymbol: number | string, leverage: number, symbol?: string): Promise<void> {
        const cleanSym = this.normalizeSymbol(symbol || String(_productIdOrSymbol));
        await this.request('POST', '/fapi/v1/leverage', {
            symbol: cleanSym,
            leverage: Math.floor(leverage),
        }).catch((err) => {
            console.warn(`[Binance] Leverage set non-fatal note: ${err?.message}`);
        });
    }

    async placeMarketOrder(_productIdOrSymbol: number | string, symbol: string, side: OrderSide, size: number): Promise<any> {
        const cleanSym = this.normalizeSymbol(symbol || String(_productIdOrSymbol));
        const binanceSide = side.toUpperCase() === 'BUY' ? 'BUY' : 'SELL';

        const res = await this.request('POST', '/fapi/v1/order', {
            symbol: cleanSym,
            side: binanceSide,
            type: 'MARKET',
            quantity: size,
            newClientOrderId: `pine_${Date.now()}`,
        });

        return {
            result: {
                id: String(res?.orderId ?? ''),
                order_id: String(res?.orderId ?? ''),
                average_fill_price: Number(res?.avgPrice || res?.price || 0),
                status: String(res?.status ?? '').toUpperCase(),
                side,
                size,
            },
            success: true,
        };
    }

    async getOrder(id: string, symbol?: string): Promise<any> {
        if (!symbol) return null;
        const cleanSym = this.normalizeSymbol(symbol);
        const res = await this.request('GET', '/fapi/v1/order', {
            symbol: cleanSym,
            orderId: id,
        });

        const status = String(res?.status ?? '').toUpperCase();
        const mappedStatus = status === 'FILLED' ? 'CLOSED' : (status === 'CANCELED' || status === 'REJECTED' || status === 'EXPIRED') ? 'CANCELLED' : 'OPEN';

        return {
            state: mappedStatus,
            status: mappedStatus,
            average_fill_price: Number(res?.avgPrice || res?.price || 0),
            limit_price: Number(res?.price || 0),
        };
    }

    async getPosition(productIdOrSymbol: number | string, symbol?: string): Promise<any> {
        const cleanSym = this.normalizeSymbol(symbol || String(productIdOrSymbol));
        const res = await this.request('GET', '/fapi/v2/positionRisk', { symbol: cleanSym });
        if (Array.isArray(res)) {
            const pos = res.find((p: any) => this.normalizeSymbol(p.symbol) === cleanSym) || res[0];
            const size = Math.abs(Number(pos?.positionAmt ?? 0));
            return {
                size,
                entry_price: Number(pos?.entryPrice ?? 0),
                side: Number(pos?.positionAmt ?? 0) > 0 ? 'buy' : 'sell',
            };
        }
        return { size: 0, entry_price: 0 };
    }

    async cancelAllOrders(productIdOrSymbol: number | string, symbol?: string): Promise<void> {
        const cleanSym = this.normalizeSymbol(symbol || String(productIdOrSymbol));
        await this.request('DELETE', '/fapi/v1/allOpenOrders', { symbol: cleanSym }).catch(() => {});
    }

    async placeBracketOrder(opts: BracketOrderParams): Promise<BracketOrderResult> {
        const { symbol, tpTrigger, slTrigger, positionSide, decimals } = opts;
        const cleanSym = this.normalizeSymbol(symbol);
        const exitSide = positionSide === 'buy' ? 'SELL' : 'BUY';
        const fmt = (n: number) => n.toFixed(decimals);

        let tpId = '';
        let slId = '';

        try {
            await this.cancelAllOrders(cleanSym);

            // 1. Take Profit Market Order (reduceOnly / closePosition)
            const tpRes = await this.request('POST', '/fapi/v1/order', {
                symbol: cleanSym,
                side: exitSide,
                type: 'TAKE_PROFIT_MARKET',
                stopPrice: fmt(tpTrigger),
                closePosition: 'true',
                workingType: 'MARK_PRICE',
            }).catch(err => {
                console.warn(`[Binance] TP Order error: ${err.message}`);
                return null;
            });
            if (tpRes?.orderId) tpId = String(tpRes.orderId);

            // 2. Stop Loss Market Order (reduceOnly / closePosition)
            const slRes = await this.request('POST', '/fapi/v1/order', {
                symbol: cleanSym,
                side: exitSide,
                type: 'STOP_MARKET',
                stopPrice: fmt(slTrigger),
                closePosition: 'true',
                workingType: 'MARK_PRICE',
            }).catch(err => {
                console.warn(`[Binance] SL Order error: ${err.message}`);
                return null;
            });
            if (slRes?.orderId) slId = String(slRes.orderId);

            return {
                success: Boolean(tpId || slId),
                tpId,
                slId,
            };
        } catch (err: any) {
            console.error(`[Binance] Failed placing TP/SL bracket: ${err?.message}`);
            return { success: false, tpId: '', slId: '' };
        }
    }
}
