// ================================================================
// BreakoutEx AI — Statistical Calibration & Confidence Interval Engine
//
// Calculates uncertainty bounds, Wilson score intervals, and sample size
// confidence penalties so AI strategy ranking is statistically sound.
// ================================================================

import { BacktestTrade } from './types';

export interface ConfidenceInterval {
    lower: number;
    upper: number;
    confidenceLevel: number; // e.g. 0.95 (95%)
    marginOfError: number;
}

export interface StatisticalCalibrationReport {
    tradeCount: number;
    sampleConfidenceMultiplier: number; // 0.0 to 1.0
    sampleSizeClassification: 'INSUFFICIENT' | 'CAUTION' | 'ACCEPTABLE' | 'STRONG';

    // Metric Confidence Intervals (95% bounds)
    winRate: number;
    winRateInterval: ConfidenceInterval;

    profitFactor: number;
    profitFactorInterval: ConfidenceInterval;

    sharpeRatio: number;
    sharpeInterval: ConfidenceInterval;

    expectancyPercent: number;
    expectancyInterval: ConfidenceInterval;

    // Calibrated Robustness Penalties
    samplePenaltyDeduction: number; // points deducted from raw score
    uncertaintyPenaltyDeduction: number;
}

export class StatisticalCalibrator {

    /**
     * Compute comprehensive statistical calibration and confidence intervals for a strategy.
     */
    static calibrate(
        trades: BacktestTrade[],
        rawWinRate: number,
        rawProfitFactor: number,
        rawSharpe: number,
        confidenceLevel = 0.95
    ): StatisticalCalibrationReport {
        const n = trades.length;
        const z = confidenceLevel === 0.99 ? 2.576 : (confidenceLevel === 0.90 ? 1.645 : 1.96);

        // 1. Sample Size Classification & Confidence Multiplier
        let classification: 'INSUFFICIENT' | 'CAUTION' | 'ACCEPTABLE' | 'STRONG';
        let sampleMultiplier = 1.0;
        let samplePenalty = 0;

        if (n < 20) {
            classification = 'INSUFFICIENT';
            sampleMultiplier = Math.max(0.2, (n / 20) * 0.5);
            samplePenalty = 35;
        } else if (n < 50) {
            classification = 'CAUTION';
            sampleMultiplier = 0.65 + ((n - 20) / 30) * 0.20;
            samplePenalty = 15;
        } else if (n < 100) {
            classification = 'ACCEPTABLE';
            sampleMultiplier = 0.85 + ((n - 50) / 50) * 0.15;
            samplePenalty = 5;
        } else {
            classification = 'STRONG';
            sampleMultiplier = 1.0;
            samplePenalty = 0;
        }

        // 2. Wilson Score Interval for Win Rate (handles small n without NaN or >100%)
        const winRateFraction = Math.max(0, Math.min(1, rawWinRate / 100));
        let winLower = 0;
        let winUpper = 0;
        let winMargin = 0;

        if (n > 0) {
            const denom = 1 + (z * z) / n;
            const center = (winRateFraction + (z * z) / (2 * n)) / denom;
            const rad = (z * Math.sqrt((winRateFraction * (1 - winRateFraction)) / n + (z * z) / (4 * n * n))) / denom;
            winLower = Math.max(0, (center - rad) * 100);
            winUpper = Math.min(100, (center + rad) * 100);
            winMargin = (winUpper - winLower) / 2;
        }

        // 3. Trade Return Series Statistics for Expectancy & Sharpe bounds
        const returns = trades.map(t => t.netPnlPercent ?? t.grossPnlPercent ?? 0);
        let meanReturn = 0;
        let stdDev = 0;

        if (n > 0) {
            meanReturn = returns.reduce((a, b) => a + b, 0) / n;
            if (n > 1) {
                const varSum = returns.reduce((acc, r) => acc + Math.pow(r - meanReturn, 2), 0);
                stdDev = Math.sqrt(varSum / (n - 1));
            }
        }

        // 4. Expectancy Confidence Interval
        const stdError = n > 1 ? stdDev / Math.sqrt(n) : 0;
        const expMargin = z * stdError;
        const expectancyInterval: ConfidenceInterval = {
            lower: Number((meanReturn - expMargin).toFixed(2)),
            upper: Number((meanReturn + expMargin).toFixed(2)),
            confidenceLevel,
            marginOfError: Number(expMargin.toFixed(2)),
        };

        // 5. Sharpe Ratio Standard Error (Lo's approximation for SE(Sharpe))
        // SE(Sharpe) ≈ sqrt((1 + (Sharpe^2 / 2)) / n)
        const sharpeSe = n > 2 ? Math.sqrt((1 + (Math.pow(rawSharpe, 2) / 2)) / n) : 1.5;
        const sharpeMargin = z * sharpeSe;
        const sharpeInterval: ConfidenceInterval = {
            lower: Number((rawSharpe - sharpeMargin).toFixed(2)),
            upper: Number((rawSharpe + sharpeMargin).toFixed(2)),
            confidenceLevel,
            marginOfError: Number(sharpeMargin.toFixed(2)),
        };

        // 6. Profit Factor Confidence Bounds (Log-normal approximation)
        const wins = returns.filter(r => r > 0);
        const losses = returns.filter(r => r < 0).map(Math.abs);
        const sumWin = wins.reduce((a, b) => a + b, 0);
        const sumLoss = losses.reduce((a, b) => a + b, 0);
        const pf = sumLoss > 0 ? sumWin / sumLoss : (sumWin > 0 ? 10 : 1);

        let pfMargin = 0.5;
        if (wins.length > 1 && losses.length > 1) {
            const seLogPf = Math.sqrt((1 / wins.length) + (1 / losses.length));
            pfMargin = pf * (Math.exp(z * seLogPf) - 1);
        }
        const profitFactorInterval: ConfidenceInterval = {
            lower: Number(Math.max(0, pf - pfMargin).toFixed(2)),
            upper: Number((pf + pfMargin).toFixed(2)),
            confidenceLevel,
            marginOfError: Number(pfMargin.toFixed(2)),
        };

        // 7. Uncertainty Penalty based on interval width
        let uncertaintyPenalty = 0;
        if (winMargin > 15) uncertaintyPenalty += 10;
        else if (winMargin > 10) uncertaintyPenalty += 5;

        if (expectancyInterval.lower < 0 && meanReturn > 0) {
            // Mean is positive but 95% CI crosses into negative return territory
            uncertaintyPenalty += 10;
        }

        return {
            tradeCount: n,
            sampleConfidenceMultiplier: Number(sampleMultiplier.toFixed(2)),
            sampleSizeClassification: classification,
            winRate: Number(rawWinRate.toFixed(2)),
            winRateInterval: {
                lower: Number(winLower.toFixed(2)),
                upper: Number(winUpper.toFixed(2)),
                confidenceLevel,
                marginOfError: Number(winMargin.toFixed(2)),
            },
            profitFactor: Number(rawProfitFactor.toFixed(2)),
            profitFactorInterval,
            sharpeRatio: Number(rawSharpe.toFixed(2)),
            sharpeInterval,
            expectancyPercent: Number(meanReturn.toFixed(2)),
            expectancyInterval,
            samplePenaltyDeduction: samplePenalty,
            uncertaintyPenaltyDeduction: uncertaintyPenalty,
        };
    }
}
