import crypto from 'crypto';
import env from '../config/env';
import { Candle, OrderSide } from '../config/types';
import { IExchangeClient, BracketOrderParams, BracketOrderResult, resolutionMs } from './exchange.interface';

export { resolutionMs };

function parseJson(t: string): any { try { return JSON.parse(t); } catch { return t; } }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Candle parser for Delta's { timestamps, opens, highs, ... } format */
function parseDeltaCandles(raw: any): Candle[] {
    if (!raw?.result) return [];
    const r = raw.result;
    if (r.timestamps) {
        return (r.timestamps as number[]).map((t: number, i: number) => ({
            timestamp: t * 1000,
            open:   Number(r.opens[i]),
            high:   Number(r.highs[i]),
            low:    Number(r.lows[i]),
            close:  Number(r.closes[i]),
            volume: Number(r.volumes?.[i] ?? 0),
        })).sort((a, b) => a.timestamp - b.timestamp);
    }
    const arr = Array.isArray(r) ? r : [];
    return arr.map((c: any) => ({
        timestamp: Number(c.time ?? c.timestamp) * 1000,
        open:   Number(c.open),
        high:   Number(c.high),
        low:    Number(c.low),
        close:  Number(c.close),
        volume: Number(c.volume ?? 0),
    })).sort((a, b) => a.timestamp - b.timestamp);
}

export class DeltaClient implements IExchangeClient {
    private timeOffset = 0;

    constructor(
        private readonly apiKey: string,
        private readonly secretKey: string,
        private readonly baseUrl: string = 'https://api.india.delta.exchange/v2',
    ) {}


    private sign(method: string, path: string, ts: number, body = ''): string {
        return crypto.createHmac('sha256', this.secretKey)
            .update(`${method}${ts}${path}${body}`)
            .digest('hex');
    }

    private headers(method: string, endpoint: string, qs: string, body: string): Record<string, string> {
        const ts  = Math.floor(Date.now() / 1000) + this.timeOffset;
        const sig = this.sign(method, `/v2${endpoint}${qs}`, ts, body);
        const h: Record<string, string> = {
            Accept:    'application/json',
            'api-key':  this.apiKey,
            signature:  sig,
            timestamp:  String(ts),
        };
        if (['POST', 'PUT', 'DELETE'].includes(method)) h['Content-Type'] = 'application/json';
        return h;
    }

    async request(method: string, endpoint: string, body?: any, params?: Record<string, string>, isPublic = false): Promise<any> {
        const qs    = params ? '?' + new URLSearchParams(params).toString() : '';
        const bodyStr = body ? JSON.stringify(body) : '';
        const url   = `${this.baseUrl}${endpoint}${qs}`;

        const maxAttempts = isPublic ? 2 : 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const opts: RequestInit = {
                    method,
                    headers: isPublic
                        ? { Accept: 'application/json' }
                        : this.headers(method, endpoint, qs, bodyStr),
                    body: (!isPublic && bodyStr && ['POST', 'PUT', 'DELETE'].includes(method)) ? bodyStr : undefined,
                    signal: AbortSignal.timeout(20_000),
                };
                const res  = await fetch(url, opts);
                const text = await res.text();
                const json = parseJson(text);

                if (!res.ok) {
                    // Handle expired signature — adjust time offset
                    if (res.status === 401 && json?.error?.code === 'expired_signature' && !isPublic && attempt < maxAttempts) {
                        const serverTime = json.error.context?.server_time;
                        if (serverTime) {
                            this.timeOffset = serverTime - Math.floor(Date.now() / 1000) + 2;
                            console.warn(`[Delta] Adjusted timeOffset to ${this.timeOffset}s`);
                            continue;
                        }
                    }
                    throw new Error(`Delta API ${res.status}: ${JSON.stringify(json)}`);
                }
                return json;
            } catch (err: any) {
                if (attempt === maxAttempts) throw err;
                await sleep(attempt * 1500);
            }
        }
    }

    // ── Market Data ─────────────────────────────────────────────
    async getCandles(symbol: string, resolution: string, limitBars = 100): Promise<Candle[]> {
        const dur  = resolutionMs(resolution);
        const now  = Date.now();
        const start = Math.floor((now - (limitBars + 5) * dur) / 1000);
        const end   = Math.floor(now / 1000);
        const raw = await this.request('GET', '/history/candles', undefined, {
            symbol, resolution, start: String(start), end: String(end),
        }, true);
        return parseDeltaCandles(raw);
    }

    async getMarkPrice(symbol: string): Promise<number> {
        const r = await this.request('GET', `/tickers/${symbol}`, undefined, undefined, true);
        return Number(r?.result?.mark_price ?? r?.result?.spot_price ?? 0);
    }

    async getProduct(symbol: string): Promise<{ id: number; tick_size: string; contract_value: string } | null> {
        const r = await this.request('GET', `/products/${symbol}`, undefined, undefined, true);
        return r?.result ?? null;
    }

    // ── Trading ──────────────────────────────────────────────────
    async setLeverage(productId: number, leverage: number): Promise<void> {
        await this.request('POST', `/products/${productId}/orders/leverage`, { leverage });
    }

    async placeMarketOrder(productId: number, symbol: string, side: OrderSide, size: number): Promise<any> {
        return this.request('POST', '/orders', {
            product_id:     productId,
            product_symbol: symbol,
            side,
            size:           Math.floor(size),
            order_type:     'market_order',
            time_in_force:  'gtc',
            client_order_id: `pine-${Date.now()}`,
        });
    }

    async getOrder(id: string): Promise<any> {
        const r = await this.request('GET', `/orders/${id}`);
        return r?.result ?? null;
    }

    async getPosition(productId: number): Promise<any> {
        const r = await this.request('GET', '/positions', undefined, { product_id: String(productId) });
        const pos = r?.result;
        return Array.isArray(pos) ? pos[0] : pos;
    }

    async cancelAllOrders(productId: number): Promise<void> {
        await this.request('DELETE', '/orders/all', {
            contract_types:          'perpetual_futures',
            cancel_limit_orders:      true,
            cancel_stop_orders:       true,
            cancel_reduce_only_orders: true,
            product_id:               productId,
        }).catch(() => {/* ignore cancel errors */});
    }

    async placeBracketOrder(opts: {
        productId:    number;
        symbol:       string;
        tpTrigger:    number;
        tpLimit:      number;
        slTrigger:    number;
        positionSide: OrderSide;
        decimals:     number;
    }): Promise<{ success: boolean; tpId: string; slId: string }> {
        const { productId, symbol, tpTrigger, tpLimit, slTrigger, positionSide, decimals } = opts;
        const fmt = (n: number) => n.toFixed(decimals);

        const payload: any = {
            product_id:     productId,
            product_symbol: symbol,
        };

        if (positionSide === 'buy') {
            payload.take_profit_order = {
                order_type:          'limit_order',
                stop_price:           fmt(tpTrigger),
                limit_price:          fmt(tpLimit),
                stop_trigger_method:  'last_traded_price',
            };
            payload.stop_loss_order = {
                order_type:          'market_order',
                stop_price:           fmt(slTrigger),
                stop_trigger_method:  'last_traded_price',
            };
        } else {
            payload.take_profit_order = {
                order_type:          'limit_order',
                stop_price:           fmt(tpTrigger),
                limit_price:          fmt(tpLimit),
                stop_trigger_method:  'last_traded_price',
            };
            payload.stop_loss_order = {
                order_type:          'market_order',
                stop_price:           fmt(slTrigger),
                stop_trigger_method:  'last_traded_price',
            };
        }

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.cancelAllOrders(productId);
                const r = await this.request('POST', '/orders/bracket', payload);
                if (r?.result) {
                    const tp = r.result.take_profit_order;
                    const sl = r.result.stop_loss_order;
                    return { success: true, tpId: String(tp?.id ?? ''), slId: String(sl?.id ?? '') };
                }
            } catch (err: any) {
                const msg = String(err).toLowerCase();
                if ((msg.includes('no_open_position') || msg.includes('insufficient_position')) && attempt < maxRetries) {
                    await sleep(1500);
                    continue;
                }
                if (attempt === maxRetries) throw err;
            }
        }
        return { success: false, tpId: '', slId: '' };
    }
}

