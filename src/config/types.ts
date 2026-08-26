// ============================================================
// Pine Script Engine Types
// ============================================================

export type OrderSide = 'buy' | 'sell';

/** Bot config fetched from Payload CMS */
export interface PineBotConfig {
    id: string;
    USER_ID: string;
    EXCHANGE: string;
    API_KEY: string;
    SECRET_KEY: string;
    SYMBOL: string;
    PRODUCT_ID: number;
    LOT_SIZE: number;
    PRICE_DECIMAL_PLACES: number;
    BASE_URL: string;

    // Pine Script
    PINE_SCRIPT: string;
    TIMEFRAME: string;       // e.g. "5m", "15m", "1h"

    // Risk config
    TP_PERCENT: number;      // Take profit % from entry (overridden by pine script if provided)
    SL_PERCENT: number;      // Stop loss % from entry (overridden by pine script if provided)
    LEVERAGE: number;
    CAPITAL_AMOUNT: number;
    MIN_TRADE_SIZE: number;  // USD (auto-deduced if not set)
    MAX_TRADE_SIZE: number;  // USD (auto-deduced if not set)
    MODE: 'safe' | 'balanced' | 'aggressive';
    MIN_RR: number;          // Minimum Risk-to-Reward ratio (e.g. 1.5, 2.0)
    MIN_SCORE: number;       // Minimum confluence score (0-100) to execute trade
    DAILY_LOSS_LIMIT: number; // % of capital
    MAX_CONCURRENT_TRADES: number;
    IS_WEEKEND_SAFETY_ENABLED: boolean;

    // SL/TP bracket buffers
    SL_TRIGGER_BUFFER_PERCENT: number;
    SL_LIMIT_BUFFER_PERCENT: number;
    TP_TRIGGER_BUFFER_PERCENT: number;
    TP_LIMIT_BUFFER_PERCENT: number;
    ESTIMATED_FEE_PERCENT: number;
    DRY_RUN: boolean;

    // AI Autonomous Management
    IS_AI_MANAGED?: boolean;
    CURRENT_STRATEGY_ID?: string;
    CURRENT_STRATEGY_NAME?: string;
    MARKET_CONDITION?: string;
    AI_REASONING?: string;
    LAST_AI_EVALUATION?: string;
    NEXT_AI_EVALUATION?: string;
}

/** OHLCV candle */
export interface Candle {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/** Signal produced by Pine Script interpreter */
export interface PineSignal {
    action:
        | 'buy'
        | 'sell'
        | 'close'
        | 'none';

    tp?: number;

    sl?: number;

    comment?: string;

    /**
     * Optional AI/confluence score.
     *
     * IMPORTANT:
     * This is NOT part of Pine execution semantics.
     */
    score?: number;

    /**
     * True when score was explicitly generated
     * by the Pine strategy / caller.
     */
    explicitScore?: boolean;

    /**
     * Diagnostic information about the signal.
     */
    source?: 'pine' | 'ai' | 'system';

    signalTimestamp?: number;
}

/** Raw bot from Payload API */
export interface RawActiveBot {
    id: string;
    USER_ID: string;
    EXCHANGE: string;
    API_KEY: string;
    SECRET_KEY: string;
    SYMBOL: string;
    PRODUCT_ID: string;
    LEVERAGE?: number;
    MIN_TRADE_SIZE?: number;
    MAX_TRADE_SIZE?: number;
    TRADING_MODE?: 'safe' | 'balanced' | 'aggressive';
    MIN_RR?: number;
    MIN_FINAL_SCORE?: number;
    DAILY_LOSS_LIMIT?: number;
    MAX_CONCURRENT_TRADES?: number;
    CAPITAL_AMOUNT: number;
    IS_WEEKEND_SAFETY_ENABLED?: boolean;
    PINE_SCRIPT?: string;
    PINE_TIMEFRAME?: string;
    PINE_TP_PERCENT?: number;
    PINE_SL_PERCENT?: number;
    BOT_TYPE?: 'ai' | 'pine';
    IS_AI_MANAGED?: boolean;
    CURRENT_STRATEGY_ID?: string;
    CURRENT_STRATEGY_NAME?: string;
    MARKET_CONDITION?: string;
    AI_REASONING?: string;
    LAST_AI_EVALUATION?: string;
    NEXT_AI_EVALUATION?: string;
}
