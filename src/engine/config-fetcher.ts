// ================================================================
// Bot config fetcher — pulls active Pine bots from Payload CMS
// ================================================================

import env from '../config/env';
import { PineBotConfig, RawActiveBot } from '../config/types';
import { decrypt } from '../utils/crypto';

const DELTA_BASE_URL = 'https://api.india.delta.exchange/v2';

// Product metadata cache (1 hour)
const productCache = new Map<string, { data: any; ts: number }>();
const PRODUCT_TTL  = 60 * 60 * 1000;

// Bot config cache (30 seconds)
let configCache: { data: PineBotConfig[]; ts: number } | null = null;
const CONFIG_TTL = 30_000;

async function fetchJson(url: string): Promise<any | null> {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
            if (!res.ok) { if (attempt === 3) return null; await new Promise(r => setTimeout(r, attempt * 1500)); continue; }
            return await res.json();
        } catch { if (attempt === 3) return null; await new Promise(r => setTimeout(r, attempt * 1500)); }
    }
    return null;
}

async function fetchDeltaProduct(symbol: string): Promise<any | null> {
    const cached = productCache.get(symbol);
    if (cached && Date.now() - cached.ts < PRODUCT_TTL) return cached.data;
    const t0 = Date.now();
    const endpoint = `/products/${symbol}`;
    console.log(`[Exchange API (Delta)] ➔ Request: GET ${endpoint} | Target: ${DELTA_BASE_URL}`);
    const data = await fetchJson(`${DELTA_BASE_URL}${endpoint}`);
    const result = data?.result ?? null;
    const duration = Date.now() - t0;
    if (result) {
        productCache.set(symbol, { data: result, ts: Date.now() });
        console.log(`[Exchange API (Delta)] ⬅ Response: GET ${endpoint} | Status: 200 (${duration}ms) | ProductID: ${result.id} | TickSize: ${result.tick_size} | ContractVal: ${result.contract_value}`);
    } else {
        console.warn(`[Exchange API (Delta)] ⬅ Error: GET ${endpoint} | Status: FAILED/NOT_FOUND (${duration}ms)`);
    }
    return result;
}

/** Map BTCUSDT -> BTCUSD for Delta */
function mapSymbol(s: string): string {
    return s.endsWith('USDT') ? s.replace('USDT', 'USD') : s;
}

export async function fetchActivePineBots(): Promise<PineBotConfig[]> {
    // Serve from cache if fresh
    if (configCache && Date.now() - configCache.ts < CONFIG_TTL) {
        console.log(`[Config] Active bots served from memory cache (${configCache.data.length} bots, age ${Math.round((Date.now() - configCache.ts) / 1000)}s / TTL ${CONFIG_TTL / 1000}s)`);
        return configCache.data;
    }

    const endpoint = `/api/trading-bots/active-subscribed/all?limit=200&offset=0&serverIp=${env.serverIp}`;
    const url = `${env.payloadUrl}${endpoint}`;
    const t0 = Date.now();
    console.log(`[Payload API] ➔ Request: GET ${endpoint} | Target: ${env.payloadUrl} | Query: limit=200, offset=0, serverIp=${env.serverIp}`);

    let raw: RawActiveBot[] = [];
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        const duration = Date.now() - t0;
        if (res.ok) {
            raw = await res.json() as RawActiveBot[];
            const botsCount = Array.isArray(raw) ? raw.length : 0;
            const botsSummary = Array.isArray(raw) && raw.length > 0
                ? raw.map(b => `${b.id} (${b.SYMBOL}, ${b.TRADING_MODE || 'balanced'}, TF=${b.PINE_TIMEFRAME || '5m'}, Cap=$${b.CAPITAL_AMOUNT || 0})`).join('; ')
                : 'None';
            console.log(`[Payload API] ⬅ Response: GET ${endpoint} | Status: ${res.status} ${res.statusText} (${duration}ms) | Bots Count: ${botsCount} | Summary: [${botsSummary}]`);
        } else {
            const errText = await res.text().catch(() => '');
            console.error(`[Payload API] ⬅ Error: GET ${endpoint} | Status: ${res.status} ${res.statusText} (${duration}ms) | Response: ${errText}`);
            return [];
        }
    } catch (err: any) {
        console.error(`[Payload API] ⬅ Error: GET ${endpoint} | Failed: ${err?.message || String(err)}`);
        return [];
    }

    if (!Array.isArray(raw) || !raw.length) {
        console.log('[Config] No active bots found');
        return [];
    }

    // Resolve Delta product data in parallel
    const deltaSymbols = [...new Set(raw.map(b => mapSymbol(b.SYMBOL)).filter(Boolean))];
    const productMap = new Map<string, any>();
    await Promise.all(deltaSymbols.map(async sym => {
        const p = await fetchDeltaProduct(sym);
        if (p) productMap.set(sym, p);
    }));

    const configs: PineBotConfig[] = raw.map(bot => {
        const mappedSym = mapSymbol(bot.SYMBOL);
        const product   = productMap.get(mappedSym);
        const decimals  = product?.tick_size?.includes('.')
            ? product.tick_size.split('.')[1].length
            : 2;

        const capital = Number(bot.CAPITAL_AMOUNT ?? 0);
        // Auto-deduce sizing if omitted
        const autoMin = capital > 0 ? Math.max(5, Math.round(capital * 0.05)) : 10;
        const autoMax = capital > 0 ? Math.max(autoMin * 2, Math.round(capital * 0.20)) : 100;

        const isAi = bot.BOT_TYPE === 'ai' || Boolean(bot.IS_AI_MANAGED);

        return {
            id:           String(bot.id),
            USER_ID:      String(bot.USER_ID),
            EXCHANGE:     (bot.EXCHANGE || 'delta').toLowerCase(),
            API_KEY:      decrypt(bot.API_KEY),
            SECRET_KEY:   decrypt(bot.SECRET_KEY),
            SYMBOL:       product?.symbol ?? mappedSym,
            PRODUCT_ID:   Number(product?.id ?? bot.PRODUCT_ID ?? 0),
            LOT_SIZE:     Number(product?.contract_value ?? 1),
            PRICE_DECIMAL_PLACES: decimals,
            BASE_URL:     DELTA_BASE_URL,

            PINE_SCRIPT:  bot.PINE_SCRIPT || '',
            TIMEFRAME:    bot.PINE_TIMEFRAME || '5m',

            TP_PERCENT:   Number(bot.PINE_TP_PERCENT ?? 1.5),
            SL_PERCENT:   Number(bot.PINE_SL_PERCENT ?? 0.8),
            LEVERAGE:     Number(bot.LEVERAGE ?? 10),
            CAPITAL_AMOUNT:       capital,
            MIN_TRADE_SIZE:       Number(bot.MIN_TRADE_SIZE || autoMin),
            MAX_TRADE_SIZE:       Number(bot.MAX_TRADE_SIZE || autoMax),
            MODE:                 (bot.TRADING_MODE || 'balanced').toLowerCase() as 'safe' | 'balanced' | 'aggressive',
            MIN_RR:               Number(bot.MIN_RR ?? 1.5),
            MIN_SCORE:            Number(bot.MIN_FINAL_SCORE ?? 60),
            DAILY_LOSS_LIMIT:     Number(bot.DAILY_LOSS_LIMIT ?? 10),
            MAX_CONCURRENT_TRADES: Number(bot.MAX_CONCURRENT_TRADES ?? 1),
            IS_WEEKEND_SAFETY_ENABLED: bot.IS_WEEKEND_SAFETY_ENABLED !== false,

            SL_TRIGGER_BUFFER_PERCENT: 0.05,
            SL_LIMIT_BUFFER_PERCENT:   0.1,
            TP_TRIGGER_BUFFER_PERCENT: 0.05,
            TP_LIMIT_BUFFER_PERCENT:   0.1,
            ESTIMATED_FEE_PERCENT:     0.05,
            DRY_RUN:                   env.dryRun,

            IS_AI_MANAGED:             isAi,
            CURRENT_STRATEGY_ID:       bot.CURRENT_STRATEGY_ID,
            CURRENT_STRATEGY_NAME:     bot.CURRENT_STRATEGY_NAME,
            MARKET_CONDITION:          bot.MARKET_CONDITION,
            AI_REASONING:              bot.AI_REASONING,
            LAST_AI_EVALUATION:        bot.LAST_AI_EVALUATION,
            NEXT_AI_EVALUATION:        bot.NEXT_AI_EVALUATION,
        } satisfies PineBotConfig;
    });

    configCache = { data: configs, ts: Date.now() };
    console.log(`[Config] Loaded ${configs.length} Pine bot config(s)`);
    return configs;
}
