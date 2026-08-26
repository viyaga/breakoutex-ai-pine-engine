// ================================================================
// BreakoutEx AI — Cross-Strategy Correlation & Portfolio Diversification
//
// Calculates cross-strategy return correlations, identifies strategy clusters,
// and evaluates portfolio diversification benefit to prevent choosing redundant strategies.
// ================================================================

import { BacktestResult, BacktestTrade } from './types';

export interface StrategyPairCorrelation {
    strategyAId: string;
    strategyAName: string;
    strategyBId: string;
    strategyBName: string;
    correlation: number; // -1.0 to +1.0
    sharedTradeOverlapPercent: number; // % of trades executing at the same timestamps
    relationship: 'HIGHLY_CORRELATED' | 'MODERATELY_CORRELATED' | 'UNCORRELATED' | 'INVERSELY_CORRELATED';
}

export interface StrategyCluster {
    clusterId: string;
    name: string; // e.g. 'Trend Continuation Cluster', 'Mean Reversion Cluster'
    strategyIds: string[];
    averageInternalCorrelation: number;
}

export interface StrategyCorrelationReport {
    strategyIds: string[];
    strategyNames: string[];
    correlationMatrix: number[][]; // N x N matrix
    pairCorrelations: StrategyPairCorrelation[];
    clusters: StrategyCluster[];
    averagePortfolioCorrelation: number;
    diversificationScore: number; // 0 - 100 (higher = more diversified)
    redundancyWarnings: string[];
}

export class StrategyCorrelationEngine {

    /**
     * Compute cross-strategy return correlations across a set of backtest results.
     */
    static analyze(results: BacktestResult[]): StrategyCorrelationReport {
        if (!results || results.length < 2) {
            return {
                strategyIds: results.map(r => r.strategyId),
                strategyNames: results.map(r => r.strategyName),
                correlationMatrix: results.length === 1 ? [[1]] : [],
                pairCorrelations: [],
                clusters: [],
                averagePortfolioCorrelation: 1.0,
                diversificationScore: 100,
                redundancyWarnings: [],
            };
        }

        const n = results.length;
        const strategyIds = results.map(r => r.strategyId);
        const strategyNames = results.map(r => r.strategyName);

        // 1. Resample equity curves into synchronized percentage returns series
        const returnVectors: number[][] = new Array(n);
        const minLength = Math.min(...results.map(r => r.equityCurve.length));

        for (let i = 0; i < n; i++) {
            const curve = results[i].equityCurve;
            const rets: number[] = [];
            for (let k = 1; k < minLength; k++) {
                const prevEq = curve[k - 1].equity || 1;
                const curEq = curve[k].equity || 1;
                rets.push((curEq - prevEq) / prevEq);
            }
            returnVectors[i] = rets;
        }

        // 2. Compute Pearson Correlation Matrix
        const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
        const pairs: StrategyPairCorrelation[] = [];
        const warnings: string[] = [];

        let offDiagSum = 0;
        let offDiagCount = 0;

        for (let i = 0; i < n; i++) {
            matrix[i][i] = 1.0;
            for (let j = i + 1; j < n; j++) {
                const corr = StrategyCorrelationEngine.pearson(returnVectors[i], returnVectors[j]);
                matrix[i][j] = Number(corr.toFixed(3));
                matrix[j][i] = Number(corr.toFixed(3));

                offDiagSum += corr;
                offDiagCount++;

                // Compute trade overlap
                const overlapPct = StrategyCorrelationEngine.calculateTradeOverlap(
                    results[i].trades,
                    results[j].trades
                );

                let relationship: StrategyPairCorrelation['relationship'];
                if (corr >= 0.70) {
                    relationship = 'HIGHLY_CORRELATED';
                    warnings.push(`High correlation (${corr.toFixed(2)}) between "${results[i].strategyName}" and "${results[j].strategyName}" creates position concentration risk.`);
                } else if (corr >= 0.35) {
                    relationship = 'MODERATELY_CORRELATED';
                } else if (corr <= -0.20) {
                    relationship = 'INVERSELY_CORRELATED';
                } else {
                    relationship = 'UNCORRELATED';
                }

                pairs.push({
                    strategyAId: strategyIds[i],
                    strategyAName: strategyNames[i],
                    strategyBId: strategyIds[j],
                    strategyBName: strategyNames[j],
                    correlation: Number(corr.toFixed(3)),
                    sharedTradeOverlapPercent: Number(overlapPct.toFixed(1)),
                    relationship,
                });
            }
        }

        const avgCorr = offDiagCount > 0 ? offDiagSum / offDiagCount : 1.0;
        const diversificationScore = Math.max(0, Math.min(100, Math.round((1 - Math.max(0, avgCorr)) * 100)));

        // 3. Cluster Strategies (Graph grouping for r >= 0.60)
        const clusters = StrategyCorrelationEngine.findClusters(results, matrix);

        return {
            strategyIds,
            strategyNames,
            correlationMatrix: matrix,
            pairCorrelations: pairs,
            clusters,
            averagePortfolioCorrelation: Number(avgCorr.toFixed(3)),
            diversificationScore,
            redundancyWarnings: warnings,
        };
    }

    private static pearson(x: number[], y: number[]): number {
        const len = Math.min(x.length, y.length);
        if (len < 3) return 0;

        let sumX = 0;
        let sumY = 0;
        for (let i = 0; i < len; i++) {
            sumX += x[i];
            sumY += y[i];
        }
        const meanX = sumX / len;
        const meanY = sumY / len;

        let num = 0;
        let denX = 0;
        let denY = 0;

        for (let i = 0; i < len; i++) {
            const dx = x[i] - meanX;
            const dy = y[i] - meanY;
            num += dx * dy;
            denX += dx * dx;
            denY += dy * dy;
        }

        const denom = Math.sqrt(denX * denY);
        return denom > 0 ? Math.max(-1, Math.min(1, num / denom)) : 0;
    }

    private static calculateTradeOverlap(tradesA: BacktestTrade[], tradesB: BacktestTrade[]): number {
        if (!tradesA.length || !tradesB.length) return 0;
        const setA = new Set(tradesA.map(t => Math.floor(t.entryTimestamp / 60000))); // 1-min binning
        let matchCount = 0;
        for (const tb of tradesB) {
            if (setA.has(Math.floor(tb.entryTimestamp / 60000))) {
                matchCount++;
            }
        }
        const minTrades = Math.min(tradesA.length, tradesB.length);
        return (matchCount / minTrades) * 100;
    }

    private static findClusters(results: BacktestResult[], matrix: number[][]): StrategyCluster[] {
        const n = results.length;
        const visited = new Set<number>();
        const clusters: StrategyCluster[] = [];

        for (let i = 0; i < n; i++) {
            if (visited.has(i)) continue;

            const clusterIndices = [i];
            visited.add(i);

            for (let j = i + 1; j < n; j++) {
                if (!visited.has(j) && matrix[i][j] >= 0.60) {
                    clusterIndices.push(j);
                    visited.add(j);
                }
            }

            if (clusterIndices.length > 1) {
                let corrSum = 0;
                let cCount = 0;
                for (let a = 0; a < clusterIndices.length; a++) {
                    for (let b = a + 1; b < clusterIndices.length; b++) {
                        corrSum += matrix[clusterIndices[a]][clusterIndices[b]];
                        cCount++;
                    }
                }
                const avgCorr = cCount > 0 ? corrSum / cCount : 1.0;
                clusters.push({
                    clusterId: `cluster_${clusters.length + 1}`,
                    name: `${results[i].strategyName} Family`,
                    strategyIds: clusterIndices.map(idx => results[idx].strategyId),
                    averageInternalCorrelation: Number(avgCorr.toFixed(2)),
                });
            }
        }

        return clusters;
    }
}
