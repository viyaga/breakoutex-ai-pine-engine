// ================================================================
// BreakoutEx AI — Exchange Specifications & Execution Rules
//
// Defines exchange contract rules, fees, leverage limits, tick sizes,
// bid/ask spreads, and funding rate specifications for realistic execution.
// ================================================================

export type SlippageModelType = 'FIXED' | 'VOLATILITY_SCALED' | 'ORDER_BOOK_DEPTH';

export interface ExchangeContractSpec {
    id: string;
    name: string;
    symbol: string;

    // Fee Schedule
    makerFeePercent: number; // e.g. 0.02 (0.02%) for Limit TP fills
    takerFeePercent: number; // e.g. 0.05 (0.05%) for Market / SL fills

    // Microstructure & Spread
    bidAskSpreadPercent: number; // e.g. 0.01 (0.01%) average spread
    slippageModel: SlippageModelType;
    baseSlippagePercent: number; // e.g. 0.03 (0.03%) base slippage
    stopLossGapSlippageMultiplier: number; // e.g. 1.5x gap multiplier during fast market moves

    // Precision & Lot Sizing
    tickSize: number; // Price precision (e.g. 0.1 for BTC, 0.01 for ETH)
    stepSize: number; // Lot size precision (e.g. 0.001)
    minQty: number; // Minimum order quantity (e.g. 0.001)
    minNotional: number; // Minimum order value in USDT (e.g. 10.0)

    // Margin & Perpetual Funding
    maxLeverage: number; // Max allowable leverage (e.g. 20x)
    maintenanceMarginPercent: number; // Liquidation margin threshold (e.g. 0.5%)
    perpetualFundingRate8hPercent: number; // Average 8h funding rate (e.g. 0.01%)
    executionLatencyMs: number; // Execution latency delay (e.g. 50ms)
}

export const PRESET_EXCHANGES: Record<string, ExchangeContractSpec> = {
    BINANCE_FUTURES_BTC: {
        id: 'binance_futures_btc',
        name: 'Binance USDT Perpetual - BTCUSDT',
        symbol: 'BTCUSDT',
        makerFeePercent: 0.02,
        takerFeePercent: 0.05,
        bidAskSpreadPercent: 0.01,
        slippageModel: 'VOLATILITY_SCALED',
        baseSlippagePercent: 0.02,
        stopLossGapSlippageMultiplier: 1.5,
        tickSize: 0.1,
        stepSize: 0.001,
        minQty: 0.001,
        minNotional: 5.0,
        maxLeverage: 20,
        maintenanceMarginPercent: 0.4,
        perpetualFundingRate8hPercent: 0.01,
        executionLatencyMs: 50,
    },

    BINANCE_FUTURES_ETH: {
        id: 'binance_futures_eth',
        name: 'Binance USDT Perpetual - ETHUSDT',
        symbol: 'ETHUSDT',
        makerFeePercent: 0.02,
        takerFeePercent: 0.05,
        bidAskSpreadPercent: 0.015,
        slippageModel: 'VOLATILITY_SCALED',
        baseSlippagePercent: 0.03,
        stopLossGapSlippageMultiplier: 1.6,
        tickSize: 0.01,
        stepSize: 0.01,
        minQty: 0.01,
        minNotional: 5.0,
        maxLeverage: 20,
        maintenanceMarginPercent: 0.5,
        perpetualFundingRate8hPercent: 0.01,
        executionLatencyMs: 50,
    },

    BYBIT_USDT_PERPETUAL: {
        id: 'bybit_usdt_perpetual',
        name: 'Bybit USDT Perpetual Contract',
        symbol: 'BTCUSDT',
        makerFeePercent: 0.02,
        takerFeePercent: 0.055,
        bidAskSpreadPercent: 0.012,
        slippageModel: 'VOLATILITY_SCALED',
        baseSlippagePercent: 0.025,
        stopLossGapSlippageMultiplier: 1.5,
        tickSize: 0.1,
        stepSize: 0.001,
        minQty: 0.001,
        minNotional: 10.0,
        maxLeverage: 25,
        maintenanceMarginPercent: 0.5,
        perpetualFundingRate8hPercent: 0.01,
        executionLatencyMs: 60,
    },

    STRICT_CONSERVATIVE: {
        id: 'strict_conservative',
        name: 'Conservative High-Friction Model',
        symbol: 'GENERIC',
        makerFeePercent: 0.04,
        takerFeePercent: 0.08,
        bidAskSpreadPercent: 0.03,
        slippageModel: 'VOLATILITY_SCALED',
        baseSlippagePercent: 0.05,
        stopLossGapSlippageMultiplier: 2.0,
        tickSize: 0.01,
        stepSize: 0.001,
        minQty: 0.001,
        minNotional: 10.0,
        maxLeverage: 10,
        maintenanceMarginPercent: 1.0,
        perpetualFundingRate8hPercent: 0.02,
        executionLatencyMs: 150,
    },
};

export class ExchangeConfig {

    static getSpec(idOrSpec?: string | ExchangeContractSpec): ExchangeContractSpec {
        if (!idOrSpec) {
            return PRESET_EXCHANGES.BINANCE_FUTURES_BTC;
        }
        if (typeof idOrSpec === 'string') {
            const found = PRESET_EXCHANGES[idOrSpec.toUpperCase()];
            if (found) return found;
            return {
                ...PRESET_EXCHANGES.BINANCE_FUTURES_BTC,
                id: idOrSpec,
                name: `Custom Exchange (${idOrSpec})`,
            };
        }
        return idOrSpec;
    }
}
