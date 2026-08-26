// ================================================================
// BreakoutEx AI — Historical Data Quality & Resilience Engine
//
// Detects corrupted candles, missing timestamps, duplicate records,
// impossible OHLC math, negative prices, and anomalous price spikes.
// Supports repair, auto-sorting, gap-filling, and strict data rejection.
// ================================================================

import { Candle } from '../config/types';

export type ValidationMode = 'STRICT' | 'REPAIR' | 'FLAG_ONLY';

export type IssueType =
    | 'UNSORTED_TIMESTAMP'
    | 'DUPLICATE_TIMESTAMP'
    | 'MISSING_INTERVAL'
    | 'INVALID_OHLC_BOUNDS'
    | 'NON_POSITIVE_PRICE'
    | 'NEGATIVE_VOLUME'
    | 'EXTREME_PRICE_SPIKE';

export interface DataQualityIssue {
    candleIndex: number;
    timestamp: number;
    type: IssueType;
    severity: 'WARNING' | 'CRITICAL';
    message: string;
    repairedValue?: Partial<Candle>;
}

export interface DataQualityReport {
    totalCandles: number;
    validCandles: number;
    missingIntervalsCount: number;
    duplicateCandlesCount: number;
    invalidOhlcCount: number;
    extremeCandlesCount: number;
    qualityScore: number; // 0 - 100 quality rating
    isUsable: boolean;
    issues: DataQualityIssue[];
    repairedCandles?: Candle[];
}

export interface ValidationOptions {
    mode?: ValidationMode;
    intervalMinutes?: number;
    maxAllowedPriceSpikePercent?: number; // e.g. 50% price move in 1 bar
    allowAutoRepair?: boolean;
}

export class HistoricalDataValidator {

    /**
     * Validate and optionally repair historical OHLCV candles.
     */
    static validate(candles: Candle[], options: ValidationOptions = {}): DataQualityReport {
        const mode = options.mode ?? 'REPAIR';
        const expectedIntervalMs = (options.intervalMinutes || 5) * 60 * 1000;
        const maxSpikePct = options.maxAllowedPriceSpikePercent || 50;

        if (!candles || candles.length === 0) {
            return {
                totalCandles: 0,
                validCandles: 0,
                missingIntervalsCount: 0,
                duplicateCandlesCount: 0,
                invalidOhlcCount: 0,
                extremeCandlesCount: 0,
                qualityScore: 0,
                isUsable: false,
                issues: [{
                    candleIndex: -1,
                    timestamp: 0,
                    type: 'MISSING_INTERVAL',
                    severity: 'CRITICAL',
                    message: 'Empty candle dataset provided',
                }],
            };
        }

        const issues: DataQualityIssue[] = [];
        let missingIntervalsCount = 0;
        let duplicateCandlesCount = 0;
        let invalidOhlcCount = 0;
        let extremeCandlesCount = 0;

        // Working copy for repair mode
        let working: Candle[] = candles.map(c => ({ ...c }));

        // 1. Check & Repair Timestamp Ordering
        let isUnsorted = false;
        for (let i = 1; i < working.length; i++) {
            if (working[i].timestamp < working[i - 1].timestamp) {
                isUnsorted = true;
                issues.push({
                    candleIndex: i,
                    timestamp: working[i].timestamp,
                    type: 'UNSORTED_TIMESTAMP',
                    severity: 'WARNING',
                    message: `Timestamp out of order (${working[i].timestamp} < ${working[i - 1].timestamp})`,
                });
            }
        }

        if (isUnsorted) {
            if (mode === 'STRICT') {
                throw new Error('[DATA_VALIDATION_ERROR] Timestamps are not strictly in chronological order');
            } else {
                working.sort((a, b) => a.timestamp - b.timestamp);
            }
        }

        // 2. Process Individual Candle Integrity
        const cleaned: Candle[] = [];
        const seenTimestamps = new Set<number>();

        for (let i = 0; i < working.length; i++) {
            const c = working[i];
            let isCandleValid = true;

            // Check Duplicate Timestamps
            if (seenTimestamps.has(c.timestamp)) {
                duplicateCandlesCount++;
                issues.push({
                    candleIndex: i,
                    timestamp: c.timestamp,
                    type: 'DUPLICATE_TIMESTAMP',
                    severity: 'WARNING',
                    message: `Duplicate timestamp detected at ${c.timestamp}`,
                });
                if (mode === 'STRICT') {
                    throw new Error(`[DATA_VALIDATION_ERROR] Duplicate timestamp ${c.timestamp} at index ${i}`);
                }
                // Skip duplicate in repair mode
                continue;
            }
            seenTimestamps.add(c.timestamp);

            // Check Non-positive Prices
            if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
                invalidOhlcCount++;
                isCandleValid = false;
                issues.push({
                    candleIndex: i,
                    timestamp: c.timestamp,
                    type: 'NON_POSITIVE_PRICE',
                    severity: 'CRITICAL',
                    message: `Non-positive price found (O:${c.open}, H:${c.high}, L:${c.low}, C:${c.close})`,
                });
                if (mode === 'STRICT') {
                    throw new Error(`[DATA_VALIDATION_ERROR] Non-positive price at candle index ${i}`);
                }
            }

            // Check Invalid OHLC Mathematical Bounds (High >= Max(O, C) and Low <= Min(O, C))
            const maxBody = Math.max(c.open, c.close);
            const minBody = Math.min(c.open, c.close);
            if (c.high < maxBody || c.low > minBody || c.low > c.high) {
                invalidOhlcCount++;
                isCandleValid = false;
                issues.push({
                    candleIndex: i,
                    timestamp: c.timestamp,
                    type: 'INVALID_OHLC_BOUNDS',
                    severity: 'CRITICAL',
                    message: `Invalid OHLC bounds (High:${c.high} < MaxBody:${maxBody} or Low:${c.low} > MinBody:${minBody})`,
                });

                if (mode === 'STRICT') {
                    throw new Error(`[DATA_VALIDATION_ERROR] Invalid OHLC bounds at candle index ${i}`);
                } else if (mode === 'REPAIR') {
                    // Repair OHLC bounds
                    c.high = Math.max(c.high, maxBody);
                    c.low = Math.min(c.low, minBody);
                }
            }

            // Check Negative Volume
            if (c.volume < 0) {
                issues.push({
                    candleIndex: i,
                    timestamp: c.timestamp,
                    type: 'NEGATIVE_VOLUME',
                    severity: 'WARNING',
                    message: `Negative volume detected (${c.volume})`,
                });
                if (mode === 'REPAIR') c.volume = Math.max(0, c.volume);
            }

            // Check Extreme Price Spikes
            if (i > 0 && cleaned.length > 0) {
                const prevClose = cleaned[cleaned.length - 1].close;
                const changePct = Math.abs((c.close - prevClose) / prevClose) * 100;
                if (changePct > maxSpikePct) {
                    extremeCandlesCount++;
                    issues.push({
                        candleIndex: i,
                        timestamp: c.timestamp,
                        type: 'EXTREME_PRICE_SPIKE',
                        severity: 'WARNING',
                        message: `Extreme single-bar price move of ${changePct.toFixed(1)}% detected`,
                    });
                }
            }

            // Check Sequence Gap / Missing Interval
            if (cleaned.length > 0) {
                const prevTs = cleaned[cleaned.length - 1].timestamp;
                const diff = c.timestamp - prevTs;
                if (diff > expectedIntervalMs * 1.5) {
                    const missingBars = Math.round(diff / expectedIntervalMs) - 1;
                    missingIntervalsCount += missingBars;
                    issues.push({
                        candleIndex: i,
                        timestamp: c.timestamp,
                        type: 'MISSING_INTERVAL',
                        severity: 'WARNING',
                        message: `Gap detected between ${prevTs} and ${c.timestamp} (${missingBars} missing bars)`,
                    });

                    // Auto gap fill in repair mode if gap is small (<= 5 missing bars)
                    if (mode === 'REPAIR' && missingBars <= 5) {
                        const lastCandle = cleaned[cleaned.length - 1];
                        for (let g = 1; g <= missingBars; g++) {
                            cleaned.push({
                                timestamp: prevTs + g * expectedIntervalMs,
                                open: lastCandle.close,
                                high: lastCandle.close,
                                low: lastCandle.close,
                                close: lastCandle.close,
                                volume: 0,
                            });
                        }
                    }
                }
            }

            if (isCandleValid || mode === 'REPAIR') {
                cleaned.push(c);
            }
        }

        // Quality Score Calculation
        const total = candles.length;
        const criticalCount = issues.filter(x => x.severity === 'CRITICAL').length;
        const warningCount = issues.filter(x => x.severity === 'WARNING').length;

        const penalty = (criticalCount * 15) + (warningCount * 2);
        const qualityScore = Math.max(0, Math.min(100, Math.round(100 - (penalty / (total / 1000 + 1)))));
        const isUsable = qualityScore >= 60 && criticalCount < (total * 0.05);

        return {
            totalCandles: total,
            validCandles: cleaned.length,
            missingIntervalsCount,
            duplicateCandlesCount,
            invalidOhlcCount,
            extremeCandlesCount,
            qualityScore,
            isUsable,
            issues,
            repairedCandles: mode === 'REPAIR' ? cleaned : undefined,
        };
    }
}
