// ================================================================
// BreakoutEx AI — Backtest Validator
//
// Validates the correctness of backtest results.
//
// This layer does NOT change trades.
// It detects suspicious/inconsistent results.
// ================================================================

import { Candle } from '../config/types';
import {
    BacktestResult,
    BacktestTrade,
} from './types';

export interface ValidationIssue {
    severity: 'error' | 'warning';

    code: string;

    message: string;

    tradeNumber?: number;
}

export interface BacktestValidationResult {

    valid: boolean;

    errors: number;

    warnings: number;

    issues: ValidationIssue[];
}

export class BacktestValidator {

    // ============================================================
    // Main validation
    // ============================================================

    static validate(
        result: BacktestResult
    ): BacktestValidationResult {

        const issues:
            ValidationIssue[] = [];

        this.validateBasicResult(
            result,
            issues
        );

        this.validateTrades(
            result,
            issues
        );

        this.validateCapital(
            result,
            issues
        );

        this.validateEquityCurve(
            result,
            issues
        );

        this.validateMetrics(
            result,
            issues
        );

        const errors =
            issues.filter(
                issue =>
                    issue.severity ===
                    'error'
            ).length;

        const warnings =
            issues.filter(
                issue =>
                    issue.severity ===
                    'warning'
            ).length;

        return {

            valid:
                errors === 0,

            errors,

            warnings,

            issues,
        };
    }

    // ============================================================
    // Basic result validation
    // ============================================================

    private static validateBasicResult(
        result: BacktestResult,
        issues: ValidationIssue[]
    ): void {

        if (
            !result.strategyId
        ) {

            issues.push({
                severity: 'error',
                code: 'MISSING_STRATEGY_ID',
                message:
                    'Backtest result has no strategy ID.',
            });
        }

        if (
            !Number.isFinite(
                result.initialCapital
            ) ||
            result.initialCapital <= 0
        ) {

            issues.push({
                severity: 'error',
                code: 'INVALID_INITIAL_CAPITAL',
                message:
                    'Initial capital must be greater than zero.',
            });
        }

        if (
            !Number.isFinite(
                result.finalCapital
            )
        ) {

            issues.push({
                severity: 'error',
                code: 'INVALID_FINAL_CAPITAL',
                message:
                    'Final capital is not finite.',
            });
        }

        if (
            result.totalTrades !==
            result.trades.length
        ) {

            issues.push({
                severity: 'error',
                code: 'TRADE_COUNT_MISMATCH',
                message:
                    `totalTrades=${result.totalTrades} ` +
                    `but trades.length=${result.trades.length}.`,
            });
        }
    }

    // ============================================================
    // Trade validation
    // ============================================================

    private static validateTrades(
        result: BacktestResult,
        issues: ValidationIssue[]
    ): void {

        let previousExitTimestamp =
            -Infinity;

        for (
            let i = 0;
            i < result.trades.length;
            i++
        ) {

            const trade =
                result.trades[i];

            this.validateTrade(
                trade,
                previousExitTimestamp,
                issues
            );

            previousExitTimestamp =
                trade.exitTimestamp;
        }
    }

    // ============================================================
    // Individual trade
    // ============================================================

    private static validateTrade(
        trade: BacktestTrade,
        previousExitTimestamp: number,
        issues: ValidationIssue[]
    ): void {

        if (
            trade.entryTimestamp >
            trade.exitTimestamp
        ) {

            issues.push({
                severity: 'error',
                code: 'INVALID_TRADE_TIME',
                message:
                    'Entry timestamp is after exit timestamp.',
                tradeNumber:
                    trade.tradeNumber,
            });
        }

        if (
            trade.entryTimestamp <
            previousExitTimestamp
        ) {

            issues.push({
                severity: 'error',
                code: 'TRADE_ORDER_ERROR',
                message:
                    'Trade starts before the previous trade ended.',
                tradeNumber:
                    trade.tradeNumber,
            });
        }

        if (
            !Number.isFinite(
                trade.entryPrice
            ) ||
            trade.entryPrice <= 0
        ) {

            issues.push({
                severity: 'error',
                code: 'INVALID_ENTRY_PRICE',
                message:
                    'Entry price must be positive and finite.',
                tradeNumber:
                    trade.tradeNumber,
            });
        }

        if (
            !Number.isFinite(
                trade.exitPrice
            ) ||
            trade.exitPrice <= 0
        ) {

            issues.push({
                severity: 'error',
                code: 'INVALID_EXIT_PRICE',
                message:
                    'Exit price must be positive and finite.',
                tradeNumber:
                    trade.tradeNumber,
            });
        }

        if (
            trade.quantity !== undefined &&
            (
                !Number.isFinite(
                    trade.quantity
                ) ||
                trade.quantity <= 0
            )
        ) {

            issues.push({
                severity: 'error',
                code: 'INVALID_QUANTITY',
                message:
                    'Trade quantity must be greater than zero.',
                tradeNumber:
                    trade.tradeNumber,
            });
        }

        if (
            !Number.isFinite(
                trade.netPnl
            )
        ) {

            issues.push({
                severity: 'error',
                code: 'INVALID_NET_PNL',
                message:
                    'Net P&L is not finite.',
                tradeNumber:
                    trade.tradeNumber,
            });
        }

        if (
            !Number.isFinite(
                trade.netPnlPercent
            )
        ) {

            issues.push({
                severity: 'error',
                code: 'INVALID_NET_PNL_PERCENT',
                message:
                    'Net P&L percentage is not finite.',
                tradeNumber:
                    trade.tradeNumber,
            });
        }

        if (
            trade.barsHeld < 0
        ) {

            issues.push({
                severity: 'error',
                code: 'NEGATIVE_BARS_HELD',
                message:
                    'barsHeld cannot be negative.',
                tradeNumber:
                    trade.tradeNumber,
            });
        }

        if (
            trade.feePercent < 0
        ) {

            issues.push({
                severity: 'error',
                code: 'NEGATIVE_FEE',
                message:
                    'Fee percentage cannot be negative.',
                tradeNumber:
                    trade.tradeNumber,
            });
        }

        if (
            trade.slippagePercent < 0
        ) {

            issues.push({
                severity: 'error',
                code: 'NEGATIVE_SLIPPAGE',
                message:
                    'Slippage percentage cannot be negative.',
                tradeNumber:
                    trade.tradeNumber,
            });
        }
    }

    // ============================================================
    // Capital validation
    // ============================================================

    private static validateCapital(
        result: BacktestResult,
        issues: ValidationIssue[]
    ): void {

        let previousCapital =
            result.initialCapital;

        for (
            const trade
            of result.trades
        ) {
            if (
                trade.capitalBefore === undefined &&
                trade.capitalAfter === undefined
            ) {
                continue;
            }

            if (
                trade.capitalBefore === undefined ||
                !Number.isFinite(
                    trade.capitalBefore
                )
            ) {

                issues.push({
                    severity: 'error',
                    code: 'INVALID_CAPITAL_BEFORE',
                    message:
                        'capitalBefore is not finite.',
                    tradeNumber:
                        trade.tradeNumber,
                });

                continue;
            }

            if (
                trade.capitalAfter === undefined ||
                !Number.isFinite(
                    trade.capitalAfter
                )
            ) {

                issues.push({
                    severity: 'error',
                    code: 'INVALID_CAPITAL_AFTER',
                    message:
                        'capitalAfter is not finite.',
                    tradeNumber:
                        trade.tradeNumber,
                });

                continue;
            }

            const capitalDifference =
                Math.abs(
                    trade.capitalBefore -
                    previousCapital
                );

            if (
                capitalDifference >
                0.01
            ) {

                issues.push({
                    severity: 'error',
                    code: 'CAPITAL_CHAIN_BROKEN',
                    message:
                        `capitalBefore=${trade.capitalBefore} ` +
                        `does not match previous ` +
                        `capitalAfter=${previousCapital}.`,
                    tradeNumber:
                        trade.tradeNumber,
                });
            }

            const netPnl =
                trade.netPnl ?? 0;

            const expectedCapital =
                trade.capitalBefore +
                netPnl;

            const pnlDifference =
                Math.abs(
                    trade.capitalAfter -
                    expectedCapital
                );

            if (
                pnlDifference >
                0.02
            ) {

                issues.push({
                    severity: 'error',
                    code: 'CAPITAL_PNL_MISMATCH',
                    message:
                        `capitalAfter differs from ` +
                        `capitalBefore + netPnl by ` +
                        `${pnlDifference.toFixed(4)}.`,
                    tradeNumber:
                        trade.tradeNumber,
                });
            }

            previousCapital =
                trade.capitalAfter;
        }

        const finalDifference =
            Math.abs(
                previousCapital -
                result.finalCapital
            );

        if (
            result.trades.length > 0 &&
            finalDifference > 0.02
        ) {

            issues.push({
                severity: 'error',
                code: 'FINAL_CAPITAL_MISMATCH',
                message:
                    `Final capital differs from ` +
                    `last trade capitalAfter by ` +
                    `${finalDifference.toFixed(4)}.`,
            });
        }
    }

    // ============================================================
    // Equity curve
    // ============================================================

    private static validateEquityCurve(
        result: BacktestResult,
        issues: ValidationIssue[]
    ): void {

        if (
            result.equityCurve.length === 0
        ) {

            issues.push({
                severity: 'warning',
                code: 'EMPTY_EQUITY_CURVE',
                message:
                    'Equity curve contains no points.',
            });

            return;
        }

        let previousTimestamp =
            -Infinity;

        for (
            const point
            of result.equityCurve
        ) {

            if (
                point.timestamp <
                previousTimestamp
            ) {

                issues.push({
                    severity: 'error',
                    code: 'EQUITY_TIME_ORDER',
                    message:
                        'Equity curve timestamps are not ordered.',
                });

                break;
            }

            previousTimestamp =
                point.timestamp;

            if (
                point.equity !== undefined &&
                !Number.isFinite(
                    point.equity
                )
            ) {

                issues.push({
                    severity: 'error',
                    code: 'INVALID_EQUITY',
                    message:
                        'Equity curve contains non-finite equity.',
                });
            }

            if (
                !Number.isFinite(
                    point.equityPercent
                )
            ) {

                issues.push({
                    severity: 'error',
                    code: 'INVALID_EQUITY_PERCENT',
                    message:
                        'Equity percentage is not finite.',
                });
            }
        }
    }

    // ============================================================
    // Metric validation
    // ============================================================

    private static validateMetrics(
        result: BacktestResult,
        issues: ValidationIssue[]
    ): void {

        const numericMetrics = [
            'winRate',
            'lossRate',
            'profitFactor',
            'netPnlPercent',
            'maxDrawdownPercent',
            'sharpeRatio',
            'sortinoRatio',
            'calmarRatio',
            'payoffRatio',
            'expectancy',
        ] as const;

        for (
            const metric
            of numericMetrics
        ) {

            const value =
                result[metric];

            if (
                !Number.isFinite(
                    value
                )
            ) {

                issues.push({
                    severity: 'error',
                    code:
                        `INVALID_METRIC_${metric.toUpperCase()}`,
                    message:
                        `${metric} is not finite.`,
                });
            }
        }

        if (
            result.maxDrawdownPercent < 0
        ) {

            issues.push({
                severity: 'error',
                code: 'NEGATIVE_DRAWDOWN',
                message:
                    'Maximum drawdown cannot be negative.',
            });
        }

        if (
            result.winRate < 0 ||
            result.winRate > 100
        ) {

            issues.push({
                severity: 'error',
                code: 'INVALID_WIN_RATE',
                message:
                    'Win rate must be between 0 and 100.',
            });
        }
    }

    // ============================================================
    // MTF lookahead validation
    // ============================================================

    static validateNoLookahead(
        signalTimestamp: number,
        visibleCandles: Map<string, Candle[]>
    ): ValidationIssue[] {

        const issues: ValidationIssue[] = [];

        for (
            const [timeframe, candles]
            of visibleCandles.entries()
        ) {

            if (
                candles.length === 0
            ) {
                continue;
            }

            const last =
                candles[
                    candles.length - 1
                ];

            if (
                last.timestamp >
                signalTimestamp
            ) {

                issues.push({

                    severity: 'error',

                    code:
                        'LOOKAHEAD_DETECTED',

                    message:
                        `Timeframe ${timeframe} ` +
                        `contains candle timestamp ` +
                        `${last.timestamp} after signal ` +
                        `timestamp ${signalTimestamp}.`,
                });
            }
        }

        return issues;
    }
}
