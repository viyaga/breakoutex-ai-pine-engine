// ================================================================
// Bybit v5 Unified Trading HTTP Client
// HMAC-SHA256 authenticated client implementing IExchangeClient
// ================================================================

import crypto from 'crypto';
import { Candle, OrderSide } from '../config/types';
import { IExchangeClient, BracketOrderParams, BracketOrderResult } from './exchange.interface';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export class BybitClient implements IExchangeClient {
    private timeOffset = 0;

    private logger?: any;
    private botId?: string;

    constructor(
        private readonly apiKey: string,
        private readonly secretKey: string,
        private readonly baseUrl: string = 'https://api.bybit.com',
    ) {}

    setLogger(logger: any, botId?: string): void {
        this.logger = logger;
        if (botId) this.botId = botId;
    }

    private sign(timestamp: number, payload: string): string {
        const recvWindow = '5000';
        const strToSign = `${timestamp}${this.apiKey}${recvWindow}${payload}`;
        return crypto.createHmac('sha256', this.secretKey)
            .update(strToSign)
            .digest('hex');
    }

    private normalizeSymbol(s: string): string {
        return s.toUpperCase().replace(/[-/_]/g, '');
    }

    private normalizeInterval(resolution: string): string {
        const r = resolution.toLowerCase().trim();
        if (r === '1' || r === '1m') return '1';
        if (r === '3' || r === '3m') return '3';
        if (r === '5' || r === '5m') return '5';
        if (r === '15' || r === '15m') return '15';
        if (r === '30' || r === '30m') return '30';
        if (r === '60' || r === '1h' || r === '60m') return '60';
        if (r === '120' || r === '2h' || r === '120m') return '120';
        if (r === '240' || r === '4h' || r === '240m') return '240';
        if (r === 'd' || r === '1d' || r === '1440') return 'D';
        if (r === 'w' || r === '1w') return 'W';
        return '5';
    }

    private async request(method: string, endpoint: string, params: Record<string, any> = {}, isPublic = false): Promise<any> {
        const maxAttempts = isPublic ? 2 : 3;
        const t0 = Date.now();
        const botPrefix = this.botId ? `[PineEngine][${this.botId}] ` : '';

        const sanitizedParams = { ...params };
        const reqDetail = Object.keys(sanitizedParams).length ? `Params: ${JSON.stringify(sanitizedParams)}` : '';
        const reqMsg = `${botPrefix}[Exchange API (Bybit)] ➔ Request: ${method} ${endpoint}${reqDetail ? ` | ${reqDetail}` : ''}`;
        if (this.logger?.addLog) this.logger.addLog(reqMsg);
        console.log(reqMsg);

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                let qs = '';
                let bodyStr = '';

                if (method === 'GET') {
                    const searchParams = new URLSearchParams();
                    for (const [k, v] of Object.entries(params)) {
                        if (v !== undefined && v !== null) searchParams.append(k, String(v));
                    }
                    qs = searchParams.toString() ? `?${searchParams.toString()}` : '';
                } else {
                    bodyStr = JSON.stringify(params);
                }

                const url = `${this.baseUrl}${endpoint}${qs}`;
                const ts = Date.now() + this.timeOffset;

                const headers: Record<string, string> = {
                    Accept: 'application/json',
                };
                if (['POST', 'PUT', 'DELETE'].includes(method)) {
                    headers['Content-Type'] = 'application/json';
                }

                if (!isPublic && this.apiKey) {
                    const payloadToSign = method === 'GET' ? (qs.startsWith('?') ? qs.slice(1) : qs) : bodyStr;
                    const sig = this.sign(ts, payloadToSign);
                    headers['X-BAPI-API-KEY'] = this.apiKey;
                    headers['X-BAPI-TIMESTAMP'] = String(ts);
                    headers['X-BAPI-SIGN'] = sig;
                    headers['X-BAPI-RECV-WINDOW'] = '5000';
                }

                const res = await fetch(url, {
                    method,
                    headers,
                    body: (method !== 'GET' && bodyStr) ? bodyStr : undefined,
                    signal: AbortSignal.timeout(15_000),
                });
                const duration = Date.now() - t0;
                const text = await res.text();
                let json: any;
                try { json = JSON.parse(text); } catch { json = text; }

                if (!res.ok || json?.retCode !== 0) {
                    const errMsg = `${botPrefix}[Exchange API (Bybit)] ⬅ Error: ${method} ${endpoint} | Status: ${res.status} (${duration}ms) | Code: ${json?.retCode} | Msg: ${json?.retMsg || JSON.stringify(json)}`;
                    if (this.logger?.addLog) this.logger.addLog(errMsg);
                    console.error(errMsg);

                    // Handle time offset error (10002)
                    if (json?.retCode === 10002 && !isPublic && attempt < maxAttempts) {
                        const timeRes = await fetch(`${this.baseUrl}/v5/market/time`).catch(() => null);
                        const timeData = (await timeRes?.json().catch(() => null)) as any;
                        if (timeData?.timeNano) {
                            const serverMs = Math.floor(Number(timeData.timeNano) / 1_000_000);
                            this.timeOffset = serverMs - Date.now();
                            console.warn(`[Bybit] Adjusted timeOffset to ${this.timeOffset}ms`);
                            continue;
                        }
                    }

                    throw new Error(`Bybit API Error (${json?.retCode}): ${json?.retMsg || JSON.stringify(json)}`);
                }

                let previewStr = '';
                if (endpoint.includes('kline') && Array.isArray(json?.result?.list)) {
                    const list = json.result.list;
                    const count = list.length;
                    if (count > 0) {
                        const first = list[list.length - 1]; // Bybit returns reverse order
                        const last = list[0];
                        const tFirst = first?.[0] ? new Date(Number(first[0])).toISOString() : 'N/A';
                        const tLast = last?.[0] ? new Date(Number(last[0])).toISOString() : 'N/A';
                        previewStr = `${count} klines [${tFirst} → ${tLast}] | Latest: O=${last?.[1]} C=${last?.[4]}`;
                    } else {
                        previewStr = '0 klines';
                    }
                } else {
                    previewStr = typeof json === 'string' ? json : JSON.stringify(json);
                    if (previewStr.length > 800) previewStr = previewStr.slice(0, 800) + '...';
                }

                const resMsg = `${botPrefix}[Exchange API (Bybit)] ⬅ Response: ${method} ${endpoint} | Status: ${res.status} (${duration}ms) | Code: ${json?.retCode} | Data: ${previewStr}`;
                if (this.logger?.addLog) this.logger.addLog(resMsg);
                console.log(resMsg);

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

        const res = await this.request('GET', '/v5/market/kline', {
            category: 'linear',
            symbol: cleanSym,
            interval,
            limit: Math.min(1000, Math.max(20, limitBars + 5)),
        }, true);

        const list = res?.result?.list;
        if (!Array.isArray(list)) return [];

        // Bybit returns newest first, so we map and sort chronologically
        return list.map((k: any[]) => ({
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
        const res = await this.request('GET', '/v5/market/tickers', {
            category: 'linear',
            symbol: cleanSym,
        }, true);

        const ticker = res?.result?.list?.[0];
        return Number(ticker?.markPrice ?? ticker?.lastPrice ?? 0);
    }

    // ── Trading & Leverage ──────────────────────────────────────
    async setLeverage(_productIdOrSymbol: number | string, leverage: number, symbol?: string): Promise<void> {
        const cleanSym = this.normalizeSymbol(symbol || String(_productIdOrSymbol));
        const levStr = String(Math.floor(leverage));
        await this.request('POST', '/v5/position/set-leverage', {
            category: 'linear',
            symbol: cleanSym,
            buyLeverage: levStr,
            sellLeverage: levStr,
        }).catch((err) => {
            // Error 110043: leverage not modified is non-fatal
            if (!String(err).includes('110043')) {
                console.warn(`[Bybit] Set leverage notice: ${err?.message}`);
            }
        });
    }

    async placeMarketOrder(_productIdOrSymbol: number | string, symbol: string, side: OrderSide, size: number): Promise<any> {
        const cleanSym = this.normalizeSymbol(symbol || String(_productIdOrSymbol));
        const bybitSide = side.toLowerCase() === 'buy' ? 'Buy' : 'Sell';

        const res = await this.request('POST', '/v5/order/create', {
            category: 'linear',
            symbol: cleanSym,
            side: bybitSide,
            orderType: 'Market',
            qty: String(size),
            timeInForce: 'GTC',
            orderLinkId: `pine_${Date.now()}`,
        });

        const orderId = String(res?.result?.orderId ?? '');
        return {
            result: {
                id: orderId,
                order_id: orderId,
                status: 'OPEN',
                side,
                size,
            },
            success: true,
        };
    }

    async getOrder(id: string, symbol?: string): Promise<any> {
        const cleanSym = symbol ? this.normalizeSymbol(symbol) : undefined;
        const res = await this.request('GET', '/v5/order/realtime', {
            category: 'linear',
            orderId: id,
            symbol: cleanSym,
        });

        const order = res?.result?.list?.[0];
        if (!order) return null;

        const status = String(order.orderStatus ?? '').toUpperCase();
        const mappedStatus = status === 'FILLED' ? 'CLOSED' : (status === 'CANCELLED' || status === 'REJECTED') ? 'CANCELLED' : 'OPEN';

        return {
            state: mappedStatus,
            status: mappedStatus,
            average_fill_price: Number(order.avgPrice || order.price || 0),
            limit_price: Number(order.price || 0),
        };
    }

    async getPosition(productIdOrSymbol: number | string, symbol?: string): Promise<any> {
        const cleanSym = this.normalizeSymbol(symbol || String(productIdOrSymbol));
        const res = await this.request('GET', '/v5/position/list', {
            category: 'linear',
            symbol: cleanSym,
        });

        const posList = res?.result?.list;
        if (Array.isArray(posList) && posList.length > 0) {
            const pos = posList[0];
            const size = Math.abs(Number(pos.size || 0));
            return {
                size,
                entry_price: Number(pos.avgPrice || pos.entryPrice || 0),
                side: String(pos.side || '').toLowerCase(),
            };
        }
        return { size: 0, entry_price: 0 };
    }

    async cancelAllOrders(productIdOrSymbol: number | string, symbol?: string): Promise<void> {
        const cleanSym = this.normalizeSymbol(symbol || String(productIdOrSymbol));
        await this.request('POST', '/v5/order/cancel-all', {
            category: 'linear',
            symbol: cleanSym,
        }).catch(() => {});
    }

    async placeBracketOrder(opts: BracketOrderParams): Promise<BracketOrderResult> {
        const { symbol, tpTrigger, slTrigger, decimals } = opts;
        const cleanSym = this.normalizeSymbol(symbol);
        const fmt = (n: number) => n.toFixed(decimals);

        try {
            // Set trading-stop on the open position directly via Bybit native TP/SL
            const res = await this.request('POST', '/v5/position/trading-stop', {
                category: 'linear',
                symbol: cleanSym,
                takeProfit: fmt(tpTrigger),
                stopLoss: fmt(slTrigger),
                tpOrderType: 'Market',
                slOrderType: 'Market',
                tpslMode: 'Full',
                positionIdx: 0,
            });

            if (res?.retCode === 0) {
                return {
                    success: true,
                    tpId: `bybit_tp_${cleanSym}_${Date.now()}`,
                    slId: `bybit_sl_${cleanSym}_${Date.now()}`,
                };
            }
        } catch (err: any) {
            console.error(`[Bybit] Failed placing trading-stop bracket: ${err?.message}`);
        }

        return { success: false, tpId: '', slId: '' };
    }
}
