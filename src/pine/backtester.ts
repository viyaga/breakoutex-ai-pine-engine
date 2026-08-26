// ================================================================
// BreakoutEx AI — Legacy Compatibility Wrapper
//
// Existing callers can continue using:
//     backtestStrategy()
//     backtestAllStrategies()
//
// Internally this now uses:
//     Backtester.run()
//     Backtester.runMany()
//
// This allows a safe migration without breaking the rest of
// BreakoutEx AI immediately.
// ================================================================

import { Candle } from '../config/types';
import {
    PineStrategyDefinition,
    getAllStrategies,
} from './strategy-library';

import {
    BacktestOptions,
    BacktestResult,
    BacktestTrade,
    BacktestStatus,
    ExitReason,
    EquityPoint,
    BacktestRequest,
} from '../backtesting/types';

import { Backtester } from '../backtesting/Backtester';

export type {
    BacktestOptions,
    BacktestResult,
    BacktestTrade,
    BacktestStatus,
    ExitReason,
    EquityPoint,
    BacktestRequest,
};

export interface LegacyBacktestConfig {
    baseTimeframe?: string;
    windowBars?: number;
    processOrdersOnClose?: boolean;
    entryFeePct?: number;
    exitFeePct?: number;
    entrySlippagePct?: number;
    exitSlippagePct?: number;
    initialCapital?: number;
    leverage?: number;
    capitalPercent?: number;
    warmupBars?: number;
    trailingStopAtrMultiplier?: number;
}

function convertLegacyOptions(
    config: LegacyBacktestConfig
): BacktestOptions {
    return {
        baseTimeframe:
            config.baseTimeframe ?? '5m',

        windowBars:
            config.windowBars ?? 10_000,

        warmupBars:
            config.warmupBars ?? 2_000,

        fees: {
            entryPct:
                config.entryFeePct ?? 0.04,

            exitPct:
                config.exitFeePct ?? 0.04,
        },

        slippage: {
            entryPct:
                config.entrySlippagePct ?? 0.03,

            exitPct:
                config.exitSlippagePct ?? 0.03,
        },

        execution: {
            processOrdersOnClose:
                config.processOrdersOnClose ?? false,

            allowReversal:
                true,

            maxOpenPositions:
                1,

            trailingStopAtrMultiplier:
                config.trailingStopAtrMultiplier,
        },

        capital: {
            initial:
                config.initialCapital ?? 10_000,

            enabled:
                true,
        },

        positionSizing: {
            mode:
                'percentage',

            capitalPercent:
                config.capitalPercent ?? 100,

            leverage:
                config.leverage ?? 1,
        },
    };
}

/**
 * Compatibility wrapper for single-strategy backtesting.
 */
export function backtestStrategy(
    strategy: PineStrategyDefinition,
    candleMap: Map<string, Candle[]>,
    baseTimeframeOrConfig: string | LegacyBacktestConfig = '5m',
    windowBars = 10_000,
    legacyOptions: Partial<BacktestOptions> & LegacyBacktestConfig = {}
): BacktestResult {
    let options: BacktestOptions;

    if (typeof baseTimeframeOrConfig === 'string') {
        const converted = convertLegacyOptions({
            ...legacyOptions,
            baseTimeframe: baseTimeframeOrConfig,
            windowBars,
        });
        options = {
            ...converted,
            ...legacyOptions,
            baseTimeframe: baseTimeframeOrConfig,
            windowBars,
            warmupBars: legacyOptions.warmupBars ?? converted.warmupBars ?? 2_000,
        };
    } else {
        options = convertLegacyOptions(baseTimeframeOrConfig);
    }

    return Backtester.run({
        strategy,
        candleMap,
        options,
    });
}

/**
 * Compatibility wrapper for multi-strategy backtesting.
 */
export function backtestAllStrategies(
    strategiesOrCandleMap: PineStrategyDefinition[] | Map<string, Candle[]>,
    candleMapOrBaseTimeframe?: Map<string, Candle[]> | string,
    baseTimeframeOrWindowBars?: string | number,
    windowBarsOrOptions?: number | Partial<BacktestOptions>,
    options: Partial<BacktestOptions> = {}
): BacktestResult[] {
    if (Array.isArray(strategiesOrCandleMap)) {
        const strategies = strategiesOrCandleMap;
        const candleMap = candleMapOrBaseTimeframe as Map<string, Candle[]>;
        const baseTimeframe = (typeof baseTimeframeOrWindowBars === 'string' ? baseTimeframeOrWindowBars : '5m');
        const windowBars = (typeof windowBarsOrOptions === 'number' ? windowBarsOrOptions : 10_000);

        return Backtester.runMany(
            strategies,
            candleMap,
            {
                ...options,
                baseTimeframe,
                windowBars,
            }
        );
    } else {
        const strategies = getAllStrategies();
        const candleMap = strategiesOrCandleMap;
        const baseTimeframe = (typeof candleMapOrBaseTimeframe === 'string' ? candleMapOrBaseTimeframe : '5m');
        const windowBars = (typeof baseTimeframeOrWindowBars === 'number' ? baseTimeframeOrWindowBars : 10_000);
        const opts = (typeof windowBarsOrOptions === 'object' ? windowBarsOrOptions : options);

        return Backtester.runMany(
            strategies,
            candleMap,
            {
                ...opts,
                baseTimeframe,
                windowBars,
            }
        );
    }
}

/**
 * Direct modern API for a single backtest request.
 */
export function runBacktest(
    request: BacktestRequest
): BacktestResult {
    return Backtester.run(request);
}

/**
 * Direct modern API for running multiple strategies.
 */
export function runBacktests(
    strategies: PineStrategyDefinition[],
    candleMap: Map<string, Candle[]>,
    options: BacktestOptions = {}
): BacktestResult[] {
    return Backtester.runMany(
        strategies,
        candleMap,
        options
    );
}
