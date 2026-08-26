// ================================================================
// BreakoutEx AI — Metrics Engine
//
// Calculates backtest statistics independently from execution.
//
// IMPORTANT:
// - Trade metrics use completed trades.
// - Risk ratios use the equity curve.
// - Sharpe/Sortino are annualized from the base timeframe.
// - No artificial score/fallback values are inserted.
// ================================================================

import {
    BacktestStatus,
    BacktestTrade,
    EquityPoint,
} from './types';

export interface MetricsInput {
    trades: BacktestTrade[];

    equityCurve: EquityPoint[];

    initialCapital: number;

    finalCapital: number;

    baseTimeframe: string;

    minSampleSize?: number;
}

export interface MetricsOutput {
    totalReturnPercent: number;

    totalTrades: number;

    wins: number;

    losses: number;

    breakevens: number;

    winRate: number;

    lossRate: number;

    profitFactor: number;

    netPnlPercent: number;

    netProfit: number;

    grossProfitPercent: number;

    grossLossPercent: number;

    maxDrawdownPercent: number;

    maxDrawdownBars: number;

    maxRunUpPercent: number;

    sharpeRatio: number;

    sortinoRatio: number;

    calmarRatio: number;

    payoffRatio: number;

    expectancy: number;

    avgBarsHeld: number;

    maxConsecutiveWins: number;

    maxConsecutiveLosses: number;

    totalFeesPaidPercent: number;

    totalSlippagePaidPercent: number;

    status: BacktestStatus;
}

export class MetricsEngine {

    // ============================================================
    // Main calculation
    // ============================================================

    static calculate(
        input: MetricsInput
    ): MetricsOutput {

        const {
            trades,
            equityCurve,
            initialCapital,
            finalCapital,
            baseTimeframe,
        } = input;

        const minSampleSize =
            input.minSampleSize ?? 4;

        const totalTrades =
            trades.length;

        // --------------------------------------------------------
        // Classify trades
        // --------------------------------------------------------

        const wins =
            trades.filter(
                trade =>
                    trade.netPnlPercent > 0.01
            );

        const losses =
            trades.filter(
                trade =>
                    trade.netPnlPercent < -0.01
            );

        const breakevens =
            trades.filter(
                trade =>
                    Math.abs(
                        trade.netPnlPercent
                    ) <= 0.01
            );

        const winCount =
            wins.length;

        const lossCount =
            losses.length;

        const breakevenCount =
            breakevens.length;

        // --------------------------------------------------------
        // Win / loss rates
        // --------------------------------------------------------

        const winRate =
            totalTrades > 0
                ? (
                    winCount /
                    totalTrades
                ) * 100
                : 0;

        const lossRate =
            totalTrades > 0
                ? (
                    lossCount /
                    totalTrades
                ) * 100
                : 0;

        // --------------------------------------------------------
        // Gross profit / loss
        // --------------------------------------------------------

        const grossProfitPercent =
            wins.reduce(
                (sum, trade) =>
                    sum +
                    trade.netPnlPercent,
                0
            );

        const grossLossPercent =
            Math.abs(
                losses.reduce(
                    (sum, trade) =>
                        sum +
                        trade.netPnlPercent,
                    0
                )
            );

        // --------------------------------------------------------
        // Profit factor
        // --------------------------------------------------------

        const profitFactor =
            grossLossPercent > 0
                ? grossProfitPercent /
                  grossLossPercent
                : grossProfitPercent > 0
                    ? Infinity
                    : 0;

        // --------------------------------------------------------
        // Net P&L
        // --------------------------------------------------------

        const netProfit =
            finalCapital -
            initialCapital;

        const netPnlPercent =
            initialCapital > 0
                ? (
                    netProfit /
                    initialCapital
                ) * 100
                : 0;

        const totalReturnPercent =
            netPnlPercent;

        // --------------------------------------------------------
        // Payoff ratio
        // --------------------------------------------------------

        const avgWin =
            winCount > 0
                ? grossProfitPercent /
                  winCount
                : 0;

        const avgLoss =
            lossCount > 0
                ? grossLossPercent /
                  lossCount
                : 0;

        const payoffRatio =
            avgLoss > 0
                ? avgWin / avgLoss
                : avgWin > 0
                    ? Infinity
                    : 0;

        // --------------------------------------------------------
        // Expectancy
        //
        // Average net return per completed trade.
        // --------------------------------------------------------

        const expectancy =
            totalTrades > 0
                ? trades.reduce(
                    (sum, trade) =>
                        sum +
                        trade.netPnlPercent,
                    0
                ) /
                  totalTrades
                : 0;

        // --------------------------------------------------------
        // Average holding period
        // --------------------------------------------------------

        const avgBarsHeld =
            totalTrades > 0
                ? trades.reduce(
                    (sum, trade) =>
                        sum +
                        trade.barsHeld,
                    0
                ) /
                  totalTrades
                : 0;

        // --------------------------------------------------------
        // Streaks
        // --------------------------------------------------------

        const streaks =
            MetricsEngine.calculateStreaks(
                trades
            );

        // --------------------------------------------------------
        // Equity curve statistics
        // --------------------------------------------------------

        const drawdown =
            MetricsEngine.calculateDrawdown(
                equityCurve
            );

        const maxRunUpPercent =
            MetricsEngine.calculateMaxRunUp(
                equityCurve
            );

        // --------------------------------------------------------
        // Risk ratios
        //
        // These use periodic equity returns rather than trade
        // returns. This is important.
        // --------------------------------------------------------

        const periodicReturns =
            MetricsEngine.calculateEquityReturns(
                equityCurve
            );

        const riskRatios =
            MetricsEngine.calculateRiskRatios(
                periodicReturns,
                baseTimeframe
            );

        // --------------------------------------------------------
        // Calmar
        //
        // Annualized return / max drawdown.
        // --------------------------------------------------------

        const years =
            MetricsEngine.calculateYears(
                equityCurve,
                baseTimeframe
            );

        const annualizedReturn =
            MetricsEngine.annualizedReturn(
                initialCapital,
                finalCapital,
                years
            );

        const calmarRatio =
            drawdown.maxDrawdownPercent > 0
                ? annualizedReturn /
                  drawdown.maxDrawdownPercent
                : annualizedReturn > 0
                    ? Infinity
                    : 0;

        // --------------------------------------------------------
        // Status
        // --------------------------------------------------------

        const status =
            MetricsEngine.determineStatus(
                totalTrades,
                minSampleSize,
                netPnlPercent,
                profitFactor
            );

        // --------------------------------------------------------
        // Costs
        // --------------------------------------------------------

        const totalFeesPaidPercent =
            trades.reduce(
                (sum, trade) =>
                    sum +
                    trade.feePercent,
                0
            );

        const totalSlippagePaidPercent =
            trades.reduce(
                (sum, trade) =>
                    sum +
                    trade.slippagePercent,
                0
            );

        return {

            totalReturnPercent:
                MetricsEngine.round(
                    totalReturnPercent,
                    4
                ),

            totalTrades,

            wins:
                winCount,

            losses:
                lossCount,

            breakevens:
                breakevenCount,

            winRate:
                MetricsEngine.round(
                    winRate,
                    2
                ),

            lossRate:
                MetricsEngine.round(
                    lossRate,
                    2
                ),

            profitFactor:
                MetricsEngine.safeMetric(
                    profitFactor
                ),

            netPnlPercent:
                MetricsEngine.round(
                    netPnlPercent,
                    4
                ),

            netProfit:
                MetricsEngine.round(
                    netProfit,
                    2
                ),

            grossProfitPercent:
                MetricsEngine.round(
                    grossProfitPercent,
                    4
                ),

            grossLossPercent:
                MetricsEngine.round(
                    grossLossPercent,
                    4
                ),

            maxDrawdownPercent:
                MetricsEngine.round(
                    drawdown.maxDrawdownPercent,
                    4
                ),

            maxDrawdownBars:
                drawdown.maxDrawdownBars,

            maxRunUpPercent:
                MetricsEngine.round(
                    maxRunUpPercent,
                    4
                ),

            sharpeRatio:
                MetricsEngine.safeMetric(
                    riskRatios.sharpe
                ),

            sortinoRatio:
                MetricsEngine.safeMetric(
                    riskRatios.sortino
                ),

            calmarRatio:
                MetricsEngine.safeMetric(
                    calmarRatio
                ),

            payoffRatio:
                MetricsEngine.safeMetric(
                    payoffRatio
                ),

            expectancy:
                MetricsEngine.round(
                    expectancy,
                    4
                ),

            avgBarsHeld:
                MetricsEngine.round(
                    avgBarsHeld,
                    2
                ),

            maxConsecutiveWins:
                streaks.maxWins,

            maxConsecutiveLosses:
                streaks.maxLosses,

            totalFeesPaidPercent:
                MetricsEngine.round(
                    totalFeesPaidPercent,
                    4
                ),

            totalSlippagePaidPercent:
                MetricsEngine.round(
                    totalSlippagePaidPercent,
                    4
                ),

            status,
        };
    }

    // ============================================================
    // Equity periodic returns
    // ============================================================

    private static calculateEquityReturns(
        equityCurve: EquityPoint[]
    ): number[] {

        const returns: number[] = [];

        for (
            let i = 1;
            i < equityCurve.length;
            i++
        ) {

            const previous =
                equityCurve[i - 1];

            const current =
                equityCurve[i];

            if (
                previous.equity !== undefined &&
                current.equity !== undefined &&
                previous.equity > 0
            ) {

                const returnPct =
                    (
                        current.equity /
                        previous.equity -
                        1
                    ) * 100;

                returns.push(
                    returnPct
                );

            } else {

                // Fallback for percentage-only curves.
                const returnPct =
                    current.equityPercent -
                    previous.equityPercent;

                returns.push(
                    returnPct
                );
            }
        }

        return returns;
    }

    // ============================================================
    // Sharpe + Sortino
    //
    // Uses periodic returns.
    // ============================================================

    private static calculateRiskRatios(
        returns: number[],
        timeframe: string
    ): {
        sharpe: number;
        sortino: number;
    } {

        if (
            returns.length < 2
        ) {

            return {
                sharpe: 0,
                sortino: 0,
            };
        }

        const mean =
            returns.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            returns.length;

        const variance =
            returns.reduce(
                (sum, value) =>
                    sum +
                    Math.pow(
                        value - mean,
                        2
                    ),
                0
            ) /
            (
                returns.length - 1
            );

        const stdDev =
            Math.sqrt(
                variance
            );

        // --------------------------------------------------------
        // Downside deviation
        //
        // Target return = 0.
        // --------------------------------------------------------

        const downsideSquares =
            returns
                .filter(
                    value =>
                        value < 0
                )
                .map(
                    value =>
                        Math.pow(
                            value,
                            2
                        )
                );

        const downsideVariance =
            downsideSquares.length > 0
                ? downsideSquares.reduce(
                    (
                        sum,
                        value
                    ) =>
                        sum + value,
                    0
                ) /
                downsideSquares.length
                : 0;

        const downsideDeviation =
            Math.sqrt(
                downsideVariance
            );

        // --------------------------------------------------------
        // Periods per year
        // --------------------------------------------------------

        const periodsPerYear =
            MetricsEngine.periodsPerYear(
                timeframe
            );

        const annualizationFactor =
            Math.sqrt(
                periodsPerYear
            );

        const sharpe =
            stdDev > 0
                ? (
                    mean /
                    stdDev
                ) *
                  annualizationFactor
                : 0;

        const sortino =
            downsideDeviation > 0
                ? (
                    mean /
                    downsideDeviation
                ) *
                  annualizationFactor
                : mean > 0
                    ? Infinity
                    : 0;

        return {
            sharpe,
            sortino,
        };
    }

    // ============================================================
    // Periods per year
    // ============================================================

    private static periodsPerYear(
        timeframe: string
    ): number {

        const minutes =
            MetricsEngine.parseTimeframeMinutes(
                timeframe
            );

        if (
            !Number.isFinite(minutes) ||
            minutes <= 0
        ) {

            return 365 * 24 * 60 / 5;
        }

        // Crypto markets trade 24/7.
        const minutesPerYear =
            365 * 24 * 60;

        return (
            minutesPerYear /
            minutes
        );
    }

    // ============================================================
    // Parse timeframe
    // ============================================================

    private static parseTimeframeMinutes(
        timeframe: string
    ): number {

        const tf =
            String(
                timeframe
            )
            .trim()
            .toLowerCase();

        if (
            tf.endsWith('m')
        ) {

            return parseInt(
                tf.slice(0, -1),
                10
            );
        }

        if (
            tf.endsWith('h')
        ) {

            return (
                parseInt(
                    tf.slice(0, -1),
                    10
                ) * 60
            );
        }

        if (
            tf.endsWith('d')
        ) {

            return (
                parseInt(
                    tf.slice(0, -1),
                    10
                ) * 24 * 60
            );
        }

        if (
            tf.endsWith('w')
        ) {

            return (
                parseInt(
                    tf.slice(0, -1),
                    10
                ) * 7 * 24 * 60
            );
        }

        if (
            /^\d+$/.test(tf)
        ) {

            return parseInt(
                tf,
                10
            );
        }

        return 5;
    }

    // ============================================================
    // Drawdown
    // ============================================================

    private static calculateDrawdown(
        equityCurve: EquityPoint[]
    ): {
        maxDrawdownPercent: number;
        maxDrawdownBars: number;
    } {

        if (
            equityCurve.length === 0
        ) {

            return {
                maxDrawdownPercent: 0,
                maxDrawdownBars: 0,
            };
        }

        let peak =
            equityCurve[0].equity ??
            equityCurve[0].equityPercent;

        let peakIndex = 0;

        let maxDrawdown = 0;

        let maxDrawdownBars = 0;

        for (
            let i = 0;
            i < equityCurve.length;
            i++
        ) {

            const value =
                equityCurve[i].equity ??
                equityCurve[i].equityPercent;

            if (
                value > peak
            ) {

                peak =
                    value;

                peakIndex =
                    i;

                continue;
            }

            if (
                peak <= 0
            ) {

                continue;
            }

            const drawdown =
                (
                    (
                        peak -
                        value
                    ) /
                    peak
                ) * 100;

            if (
                drawdown >
                maxDrawdown
            ) {

                maxDrawdown =
                    drawdown;

                maxDrawdownBars =
                    i -
                    peakIndex;
            }
        }

        return {
            maxDrawdownPercent:
                maxDrawdown,

            maxDrawdownBars,
        };
    }

    // ============================================================
    // Maximum run-up
    // ============================================================

    private static calculateMaxRunUp(
        equityCurve: EquityPoint[]
    ): number {

        if (
            equityCurve.length === 0
        ) {

            return 0;
        }

        const first =
            equityCurve[0].equity ??
            0;

        if (
            first > 0
        ) {

            let peak =
                first;

            let maxRunUp =
                0;

            for (
                const point
                of equityCurve
            ) {

                const value =
                    point.equity ??
                    first *
                    (
                        1 +
                        point.equityPercent /
                        100
                    );

                if (
                    value > peak
                ) {

                    peak =
                        value;

                    maxRunUp =
                        (
                            (
                                peak -
                                first
                            ) /
                            first
                        ) * 100;
                }
            }

            return maxRunUp;
        }

        // Percentage-only fallback.
        return Math.max(
            0,
            ...equityCurve.map(
                point =>
                    point.equityPercent
            )
        );
    }

    // ============================================================
    // Streaks
    // ============================================================

    private static calculateStreaks(
        trades: BacktestTrade[]
    ): {
        maxWins: number;
        maxLosses: number;
    } {

        let wins = 0;

        let losses = 0;

        let maxWins = 0;

        let maxLosses = 0;

        for (
            const trade of trades
        ) {

            if (
                trade.netPnlPercent > 0.01
            ) {

                wins++;

                losses = 0;

                maxWins =
                    Math.max(
                        maxWins,
                        wins
                    );

            } else if (
                trade.netPnlPercent < -0.01
            ) {

                losses++;

                wins = 0;

                maxLosses =
                    Math.max(
                        maxLosses,
                        losses
                    );

            } else {

                wins = 0;
                losses = 0;
            }
        }

        return {
            maxWins,
            maxLosses,
        };
    }

    // ============================================================
    // Years in backtest
    // ============================================================

    private static calculateYears(
        equityCurve: EquityPoint[],
        timeframe: string
    ): number {

        if (
            equityCurve.length < 2
        ) {

            return 0;
        }

        const first =
            equityCurve[0].timestamp;

        const last =
            equityCurve[
                equityCurve.length - 1
            ].timestamp;

        const elapsedMs =
            Math.max(
                0,
                last - first
            );

        const elapsedYears =
            elapsedMs /
            (
                365 *
                24 *
                60 *
                60 *
                1000
            );

        // If timestamps are unavailable or effectively zero,
        // estimate duration from number of bars.
        if (
            elapsedYears <= 0
        ) {

            const minutes =
                MetricsEngine.parseTimeframeMinutes(
                    timeframe
                );

            return (
                equityCurve.length *
                minutes
            ) /
            (
                365 *
                24 *
                60
            );
        }

        return elapsedYears;
    }

    // ============================================================
    // Annualized return
    // ============================================================

    private static annualizedReturn(
        initialCapital: number,
        finalCapital: number,
        years: number
    ): number {

        if (
            initialCapital <= 0 ||
            finalCapital <= 0
        ) {

            return 0;
        }

        if (
            years <= 0
        ) {

            return (
                (
                    finalCapital /
                    initialCapital
                ) - 1
            ) * 100;
        }

        return (
            Math.pow(
                finalCapital /
                initialCapital,
                1 / years
            ) - 1
        ) * 100;
    }

    // ============================================================
    // Status
    // ============================================================

    private static determineStatus(
        totalTrades: number,
        minSampleSize: number,
        netPnlPercent: number,
        profitFactor: number
    ): BacktestStatus {

        if (
            totalTrades === 0
        ) {

            return 'no_triggers';
        }

        if (
            totalTrades <
            minSampleSize
        ) {

            return 'insufficient_sample';
        }

        if (
            netPnlPercent > 0.5 &&
            profitFactor >= 1.2
        ) {

            return 'profitable';
        }

        if (
            netPnlPercent < -0.5 ||
            profitFactor < 0.9
        ) {

            return 'losing';
        }

        return 'neutral';
    }

    // ============================================================
    // Helpers
    // ============================================================

    private static round(
        value: number,
        decimals: number
    ): number {

        if (
            !Number.isFinite(value)
        ) {

            return value;
        }

        const factor =
            Math.pow(
                10,
                decimals
            );

        return (
            Math.round(
                value * factor
            ) / factor
        );
    }

    private static safeMetric(
        value: number
    ): number {

        if (
            value === Infinity
        ) {

            return 999;
        }

        if (
            value === -Infinity
        ) {

            return -999;
        }

        if (
            !Number.isFinite(value)
        ) {

            return 0;
        }

        return MetricsEngine.round(
            value,
            4
        );
    }
}
