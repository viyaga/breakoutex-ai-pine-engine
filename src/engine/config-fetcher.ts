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
    const data = await fetchJson(`${DELTA_BASE_URL}/products/${symbol}`);
    const result = data?.result ?? null;
    if (result) productCache.set(symbol, { data: result, ts: Date.now() });
    return result;
}

/** Map BTCUSDT -> BTCUSD for Delta */
function mapSymbol(s: string): string {
    return s.endsWith('USDT') ? s.replace('USDT', 'USD') : s;
}

export async function fetchActivePineBots(): Promise<PineBotConfig[]> {
    // Serve from cache if fresh
    if (configCache && Date.now() - configCache.ts < CONFIG_TTL) return configCache.data;

    const url = `${env.payloadUrl}/api/trading-bots/active-subscribed/all?limit=200&offset=0&serverIp=${env.serverIp}`;
    const raw: RawActiveBot[] = await fetchJson(url) ?? [];

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
