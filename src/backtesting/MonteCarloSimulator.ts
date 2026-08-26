// ================================================================
// BreakoutEx AI — Monte Carlo Robustness Simulator
//
// Performs trade sequence permutation and resampling to determine
// whether a strategy's performance depends on a lucky sequence of trades
// or is statistically robust across randomized execution orderings.
// ================================================================

import { BacktestTrade } from './types';

export interface MonteCarloOptions {
    /**
     * Number of simulation iterations (default: 1,000).
     */
    iterations?: number;

    /**
     * Confidence interval percentile (default: 95).
     */
    confidencePercentile?: number;

    /**
     * Account drawdown percentage considered total ruin (default: 50%).
     */
    ruinThresholdPercent?: number;

    /**
     * Number of equity curve trajectories to store for visualization (default: 20).
     */
    sampleCurvesToKeep?: number;
}

export interface MonteCarloSimulationResult {
    iterations: number;
    initialCapital: number;

    // Return distribution
    medianReturnPercent: number;
    p5ReturnPercent: number; // 5th percentile (conservative / worst case)
    p95ReturnPercent: number; // 95th percentile (optimistic / best case)
    meanReturnPercent: number;
    stdDevReturnPercent: number;

    // Drawdown distribution
    medianMaxDrawdownPercent: number;
    p95MaxDrawdownPercent: number; // 95th percentile worst drawdown
    maxSimulatedDrawdownPercent: number;

    // Risk of Ruin
    probabilityOfRuinPercent: number;
    profitProbabilityPercent: number;

    // Overall Monte Carlo Robustness Index (0 - 100)
    robustnessScore: number;

    // Sample curves for charting
    sampledEquityCurves: number[][];
}

export class MonteCarloSimulator {

    /**
     * Run Monte Carlo simulation on a list of completed trades.
     */
    static run(
        trades: BacktestTrade[],
        initialCapital = 10000,
        options: MonteCarloOptions = {}
    ): MonteCarloSimulationResult {
        const iterations = options.iterations ?? 1000;
        const pConfidence = options.confidencePercentile ?? 95;
        const ruinPct = options.ruinThresholdPercent ?? 50;
        const sampleCount = options.sampleCurvesToKeep ?? 20;

        if (!Array.isArray(trades) || trades.length === 0) {
            return {
                iterations: 0,
                initialCapital,
                medianReturnPercent: 0,
                p5ReturnPercent: 0,
                p95ReturnPercent: 0,
                meanReturnPercent: 0,
                stdDevReturnPercent: 0,
                medianMaxDrawdownPercent: 0,
                p95MaxDrawdownPercent: 0,
                maxSimulatedDrawdownPercent: 0,
                probabilityOfRuinPercent: 0,
                profitProbabilityPercent: 0,
                robustnessScore: 0,
                sampledEquityCurves: [],
            };
        }

        const tradeReturnsPct = trades.map(t => t.netPnlPercent ?? t.grossPnlPercent ?? 0);
        const numTrades = tradeReturnsPct.length;

        const simulatedReturnsPct: number[] = new Array(iterations);
        const simulatedMaxDrawdownsPct: number[] = new Array(iterations);
        const sampledCurves: number[][] = [];

        let ruinCount = 0;
        let profitableCount = 0;

        for (let iter = 0; iter < iterations; iter++) {
            let currentEquity = initialCapital;
            let peakEquity = initialCapital;
            let maxDrawdownPct = 0;
            let ruined = false;

            const curvePoints: number[] = [initialCapital];

            for (let t = 0; t < numTrades; t++) {
                // Randomly sample with replacement
                const randomIndex = Math.floor(Math.random() * numTrades);
                const retPct = tradeReturnsPct[randomIndex];

                // Apply return
                const pnl = currentEquity * (retPct / 100);
                currentEquity = Math.max(0, currentEquity + pnl);

                if (currentEquity > peakEquity) {
                    peakEquity = currentEquity;
                } else if (peakEquity > 0) {
                    const ddPct = ((peakEquity - currentEquity) / peakEquity) * 100;
                    if (ddPct > maxDrawdownPct) {
                        maxDrawdownPct = ddPct;
                    }
                    if (ddPct >= ruinPct) {
                        ruined = true;
                    }
                }

                if (iter < sampleCount) {
                    curvePoints.push(Number(currentEquity.toFixed(2)));
                }
            }

            if (iter < sampleCount) {
                sampledCurves.push(curvePoints);
            }

            const totalReturnPct = ((currentEquity - initialCapital) / initialCapital) * 100;
            simulatedReturnsPct[iter] = totalReturnPct;
            simulatedMaxDrawdownsPct[iter] = maxDrawdownPct;

            if (ruined || currentEquity <= initialCapital * (1 - ruinPct / 100)) {
                ruinCount++;
            }
            if (totalReturnPct > 0) {
                profitableCount++;
            }
        }

        // Sort arrays for percentile calculation
        simulatedReturnsPct.sort((a, b) => a - b);
        simulatedMaxDrawdownsPct.sort((a, b) => a - b);

        const getPercentile = (arr: number[], pct: number): number => {
            const index = Math.floor((pct / 100) * (arr.length - 1));
            return arr[Math.max(0, Math.min(arr.length - 1, index))];
        };

        const medianReturnPercent = getPercentile(simulatedReturnsPct, 50);
        const p5ReturnPercent = getPercentile(simulatedReturnsPct, 5);
        const p95ReturnPercent = getPercentile(simulatedReturnsPct, 95);

        const medianMaxDrawdownPercent = getPercentile(simulatedMaxDrawdownsPct, 50);
        const p95MaxDrawdownPercent = getPercentile(simulatedMaxDrawdownsPct, pConfidence);
        const maxSimulatedDrawdownPercent = simulatedMaxDrawdownsPct[simulatedMaxDrawdownsPct.length - 1];

        // Mean & Std Dev of Returns
        let sumReturn = 0;
        for (let i = 0; i < iterations; i++) {
            sumReturn += simulatedReturnsPct[i];
        }
        const meanReturnPercent = sumReturn / iterations;

        let varSum = 0;
        for (let i = 0; i < iterations; i++) {
            const diff = simulatedReturnsPct[i] - meanReturnPercent;
            varSum += diff * diff;
        }
        const stdDevReturnPercent = Math.sqrt(varSum / iterations);

        const probabilityOfRuinPercent = Number(((ruinCount / iterations) * 100).toFixed(2));
        const profitProbabilityPercent = Number(((profitableCount / iterations) * 100).toFixed(2));

        // Robustness Score Formulation (0 - 100)
        // Rewards positive p5 returns, low ruin probability, and low p95 drawdown
        let score = 50;
        if (p5ReturnPercent > 0) score += 20;
        else if (p5ReturnPercent > -10) score += 10;
        else score -= 15;

        if (probabilityOfRuinPercent === 0) score += 15;
        else if (probabilityOfRuinPercent < 5) score += 5;
        else score -= 25;

        if (p95MaxDrawdownPercent < 20) score += 15;
        else if (p95MaxDrawdownPercent < 35) score += 5;
        else score -= 15;

        if (profitProbabilityPercent >= 80) score += 10;
        else if (profitProbabilityPercent < 50) score -= 15;

        const robustnessScore = Math.max(0, Math.min(100, Math.round(score)));

        return {
            iterations,
            initialCapital,
            medianReturnPercent: Number(medianReturnPercent.toFixed(2)),
            p5ReturnPercent: Number(p5ReturnPercent.toFixed(2)),
            p95ReturnPercent: Number(p95ReturnPercent.toFixed(2)),
            meanReturnPercent: Number(meanReturnPercent.toFixed(2)),
            stdDevReturnPercent: Number(stdDevReturnPercent.toFixed(2)),
            medianMaxDrawdownPercent: Number(medianMaxDrawdownPercent.toFixed(2)),
            p95MaxDrawdownPercent: Number(p95MaxDrawdownPercent.toFixed(2)),
            maxSimulatedDrawdownPercent: Number(maxSimulatedDrawdownPercent.toFixed(2)),
            probabilityOfRuinPercent,
            profitProbabilityPercent,
            robustnessScore,
            sampledEquityCurves: sampledCurves,
        };
    }
}
