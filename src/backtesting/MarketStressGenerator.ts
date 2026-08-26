// ================================================================
// BreakoutEx AI — Synthetic Market Stress Generator
//
// Injects extreme market conditions (Flash Crash, Flash Pump, Volatility Explosion,
// Liquidity Collapse, Price Gaps, and Corrupted Data) into historical candle series
// to test backtester robustness under adverse environments.
// ================================================================

import { Candle } from '../config/types';

export type StressScenarioType =
    | 'FLASH_CRASH'
    | 'FLASH_PUMP'
    | 'VOLATILITY_EXPLOSION'
    | 'LIQUIDITY_COLLAPSE'
    | 'GAP_DOWN'
    | 'DATA_CORRUPTION';

export interface StressScenarioSpec {
    type: StressScenarioType;
    name: string;
    description: string;
    targetBarIndexPct?: number; // e.g. 50% into the dataset
}

export class MarketStressGenerator {

    /**
     * Inject a specific controlled stress scenario into a candle dataset.
     */
    static injectStressScenario(candles: Candle[], scenarioType: StressScenarioType): Candle[] {
        if (!candles || candles.length < 50) return candles;

        const result: Candle[] = candles.map(c => ({ ...c }));
        const midIdx = Math.floor(result.length * 0.5);

        switch (scenarioType) {
            case 'FLASH_CRASH': {
                // Sudden -25% drop over 3 bars starting at midIdx
                let currentPrice = result[midIdx].open;
                for (let k = 0; k < 3; k++) {
                    const idx = midIdx + k;
                    if (idx >= result.length) break;
                    const dropPct = (k === 1) ? 0.15 : 0.05;
                    const open = currentPrice;
                    const close = currentPrice * (1 - dropPct);
                    const low = close * 0.97;
                    const high = open * 1.01;
                    const volume = result[idx].volume * 5.0;

                    result[idx] = {
                        timestamp: result[idx].timestamp,
                        open,
                        high,
                        low,
                        close,
                        volume,
                    };
                    currentPrice = close;
                }
                // Subsequent candles rebase to the new price level
                for (let j = midIdx + 3; j < result.length; j++) {
                    const ratio = result[j].close / result[j - 1].close;
                    const open = currentPrice;
                    const close = currentPrice * (ratio > 0 ? ratio : 1.0);
                    const high = Math.max(open, close) * 1.01;
                    const low = Math.min(open, close) * 0.99;
                    result[j] = {
                        ...result[j],
                        open,
                        high,
                        low,
                        close,
                    };
                    currentPrice = close;
                }
                break;
            }

            case 'FLASH_PUMP': {
                // Sudden +30% pump over 3 bars
                let currentPrice = result[midIdx].open;
                for (let k = 0; k < 3; k++) {
                    const idx = midIdx + k;
                    if (idx >= result.length) break;
                    const pumpPct = (k === 1) ? 0.18 : 0.06;
                    const open = currentPrice;
                    const close = currentPrice * (1 + pumpPct);
                    const high = close * 1.02;
                    const low = open * 0.99;
                    const volume = result[idx].volume * 6.0;

                    result[idx] = {
                        timestamp: result[idx].timestamp,
                        open,
                        high,
                        low,
                        close,
                        volume,
                    };
                    currentPrice = close;
                }
                break;
            }

            case 'VOLATILITY_EXPLOSION': {
                // 4x High-Low range expansion for 30 bars
                for (let k = 0; k < 30; k++) {
                    const idx = midIdx + k;
                    if (idx >= result.length) break;
                    const c = result[idx];
                    const range = Math.abs(c.high - c.low);
                    const expRange = range * 4.0;
                    const mid = (c.open + c.close) / 2;

                    result[idx] = {
                        ...c,
                        high: mid + (expRange / 2),
                        low: Math.max(1, mid - (expRange / 2)),
                        volume: c.volume * 2.5,
                    };
                }
                break;
            }

            case 'LIQUIDITY_COLLAPSE': {
                // Volume drops to 5%, wide spreads
                for (let k = 0; k < 40; k++) {
                    const idx = midIdx + k;
                    if (idx >= result.length) break;
                    const c = result[idx];
                    const spread = c.close * 0.02; // 2% spread
                    result[idx] = {
                        ...c,
                        high: Math.max(c.open, c.close) + spread,
                        low: Math.min(c.open, c.close) - spread,
                        volume: Math.max(1, c.volume * 0.05),
                    };
                }
                break;
            }

            case 'GAP_DOWN': {
                // Single-bar 12% gap down open
                const idx = midIdx;
                const prevClose = result[idx - 1].close;
                const gapOpen = prevClose * 0.88;
                result[idx] = {
                    ...result[idx],
                    open: gapOpen,
                    high: Math.max(gapOpen, result[idx].high),
                    low: Math.min(gapOpen * 0.98, result[idx].low),
                    close: gapOpen * 0.99,
                };
                break;
            }

            case 'DATA_CORRUPTION': {
                // Injects inverted high/low, negative price, and duplicate timestamp
                if (midIdx + 5 < result.length) {
                    // Inverted high/low
                    result[midIdx] = {
                        ...result[midIdx],
                        high: result[midIdx].open * 0.8,
                        low: result[midIdx].open * 1.2,
                    };
                    // Duplicate timestamp
                    result[midIdx + 1].timestamp = result[midIdx].timestamp;
                    // Negative volume
                    result[midIdx + 2].volume = -500;
                }
                break;
            }
        }

        return result;
    }

    /**
     * Generate all stress scenario datasets for comprehensive strategy benchmarking.
     */
    static generateAllScenarios(candles: Candle[]): Record<StressScenarioType, Candle[]> {
        return {
            FLASH_CRASH: MarketStressGenerator.injectStressScenario(candles, 'FLASH_CRASH'),
            FLASH_PUMP: MarketStressGenerator.injectStressScenario(candles, 'FLASH_PUMP'),
            VOLATILITY_EXPLOSION: MarketStressGenerator.injectStressScenario(candles, 'VOLATILITY_EXPLOSION'),
            LIQUIDITY_COLLAPSE: MarketStressGenerator.injectStressScenario(candles, 'LIQUIDITY_COLLAPSE'),
            GAP_DOWN: MarketStressGenerator.injectStressScenario(candles, 'GAP_DOWN'),
            DATA_CORRUPTION: MarketStressGenerator.injectStressScenario(candles, 'DATA_CORRUPTION'),
        };
    }
}
