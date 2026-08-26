// ================================================================
// BreakoutEx AI — Portfolio Optimizer & Capital Allocation Engine
//
// Constructs multi-strategy portfolios, optimizes risk parity and regime weights,
// simulates synchronized portfolio equity curves, and calculates portfolio drawdowns.
// ================================================================

import { BacktestResult, EquityPoint } from './types';
import { StrategyCorrelationReport, StrategyCluster } from './StrategyCorrelationEngine';

export type AllocationModel =
    | 'EQUAL_WEIGHT'
    | 'INVERSE_VOLATILITY'
    | 'SHARPE_WEIGHTED'
    | 'REGIME_CONDITIONED'
    | 'CLUSTER_BALANCED';

export interface StrategyAllocationInput {
    strategyId: string;
    strategyName: string;
    result: BacktestResult;
    deploymentScore?: number;
    clusterId?: string;
    targetRegime?: string;
}

export interface StrategyAllocation {
    strategyId: string;
    strategyName: string;
    clusterId?: string;
    weightPercent: number; // e.g. 35.0 (35%)
    allocatedCapital: number; // e.g. $3,500
    riskBudgetPercent: number; // e.g. 2.0%
    deploymentScore: number;
}

export interface PortfolioAllocationReport {
    totalCapital: number;
    allocationModel: AllocationModel;
    strategyAllocations: StrategyAllocation[];
    cashReservePercent: number;
    cashReserveAmount: number;

    // Synchronized Portfolio Performance
    portfolioReturnPercent: number;
    portfolioSharpe: number;
    portfolioSortino: number;
    portfolioMaxDrawdownPercent: number;
    weightedComponentDrawdownPercent: number;
    diversificationBenefitPercent: number; // % reduction in drawdown vs weighted sum
    portfolioEquityCurve: EquityPoint[];

    // Cluster Breakdown
    clusterWeights: Record<string, number>;
}

export interface PortfolioOptimizationOptions {
    model?: AllocationModel;
    totalCapital?: number; // default: $10,000
    cashReservePercent?: number; // default: 10% cash cushion
    maxWeightPerStrategyPercent?: number; // default: 40%
    maxClusterExposurePercent?: number; // default: 45%
}

export class PortfolioOptimizer {

    /**
     * Optimize multi-strategy capital allocation and simulate synchronized portfolio equity.
     */
    static optimize(
        strategies: StrategyAllocationInput[],
        correlationReport?: StrategyCorrelationReport,
        options: PortfolioOptimizationOptions = {}
    ): PortfolioAllocationReport {
        const totalCapital = options.totalCapital ?? 10000;
        const model = options.model ?? 'CLUSTER_BALANCED';
        const cashReservePct = options.cashReservePercent ?? 10.0;
        const maxStrategyWeight = options.maxWeightPerStrategyPercent ?? 40.0;
        const maxClusterWeight = options.maxClusterExposurePercent ?? 45.0;

        if (!strategies || strategies.length === 0) {
            return {
                totalCapital,
                allocationModel: model,
                strategyAllocations: [],
                cashReservePercent: 100,
                cashReserveAmount: totalCapital,
                portfolioReturnPercent: 0,
                portfolioSharpe: 0,
                portfolioSortino: 0,
                portfolioMaxDrawdownPercent: 0,
                weightedComponentDrawdownPercent: 0,
                diversificationBenefitPercent: 0,
                portfolioEquityCurve: [],
                clusterWeights: {},
            };
        }

        const n = strategies.length;
        const deployableCapitalPct = 100.0 - cashReservePct;
        const rawWeights = new Array<number>(n).fill(1);

        // 1. Calculate Raw Model Weights
        for (let i = 0; i < n; i++) {
            const s = strategies[i];
            const res = s.result;

            if (model === 'EQUAL_WEIGHT') {
                rawWeights[i] = 1.0;
            } else if (model === 'INVERSE_VOLATILITY') {
                // Volatility approx = MaxDrawdown + 1
                const vol = Math.max(1, res.maxDrawdownPercent || 5);
                rawWeights[i] = 1.0 / vol;
            } else if (model === 'SHARPE_WEIGHTED') {
                rawWeights[i] = Math.max(0.1, res.sharpeRatio || 0.5);
            } else if (model === 'REGIME_CONDITIONED') {
                const deployScore = s.deploymentScore ?? 50;
                rawWeights[i] = Math.pow(deployScore / 50, 1.5);
            } else if (model === 'CLUSTER_BALANCED') {
                const deployScore = s.deploymentScore ?? 50;
                const sharpe = Math.max(0.2, res.sharpeRatio || 0.5);
                rawWeights[i] = (deployScore / 50) * Math.sqrt(sharpe);
            }
        }

        // 2. Normalize and Apply Caps (Strategy Cap & Cluster Cap)
        let sumRaw = rawWeights.reduce((a, b) => a + b, 0);
        let normalizedWeights = rawWeights.map(w => (w / sumRaw) * deployableCapitalPct);

        // Cap individual strategies
        for (let iter = 0; iter < 3; iter++) {
            let excess = 0;
            for (let i = 0; i < n; i++) {
                if (normalizedWeights[i] > maxStrategyWeight) {
                    excess += normalizedWeights[i] - maxStrategyWeight;
                    normalizedWeights[i] = maxStrategyWeight;
                }
            }
            // Distribute excess to uncapped strategies
            const uncappedIndices = normalizedWeights.map((w, idx) => w < maxStrategyWeight ? idx : -1).filter(idx => idx >= 0);
            if (excess > 0 && uncappedIndices.length > 0) {
                const addPer = excess / uncappedIndices.length;
                for (const idx of uncappedIndices) {
                    normalizedWeights[idx] += addPer;
                }
            }
        }

        // Cluster balancing
        const clusterMap: Record<string, number> = {};
        for (let i = 0; i < n; i++) {
            const clId = strategies[i].clusterId ?? 'unclustered';
            clusterMap[clId] = (clusterMap[clId] || 0) + normalizedWeights[i];
        }

        for (const [clId, totalClWeight] of Object.entries(clusterMap)) {
            if (clId !== 'unclustered' && totalClWeight > maxClusterWeight) {
                const reductionFactor = maxClusterWeight / totalClWeight;
                for (let i = 0; i < n; i++) {
                    if (strategies[i].clusterId === clId) {
                        normalizedWeights[i] *= reductionFactor;
                    }
                }
            }
        }

        // Re-normalize to total deployable capital
        const finalWeightSum = normalizedWeights.reduce((a, b) => a + b, 0);
        const actualCashPct = Number((100.0 - finalWeightSum).toFixed(2));
        const actualCashDollars = Number((totalCapital * (actualCashPct / 100)).toFixed(2));

        const allocations: StrategyAllocation[] = strategies.map((s, idx) => {
            const wPct = Number(normalizedWeights[idx].toFixed(2));
            const cap = Number((totalCapital * (wPct / 100)).toFixed(2));
            return {
                strategyId: s.strategyId,
                strategyName: s.strategyName,
                clusterId: s.clusterId,
                weightPercent: wPct,
                allocatedCapital: cap,
                riskBudgetPercent: Number((wPct * 0.02).toFixed(2)), // 2% risk of allocated capital
                deploymentScore: s.deploymentScore ?? 50,
            };
        });

        // 3. Simulate Synchronized Portfolio Equity Curve
        const minCurveLength = Math.min(...strategies.map(s => s.result.equityCurve.length));
        const portfolioCurve: EquityPoint[] = [];

        let portfolioPeak = totalCapital;
        let portfolioMaxDd = 0;

        for (let t = 0; t < minCurveLength; t++) {
            let totalEq = actualCashDollars;
            const ts = strategies[0].result.equityCurve[t].timestamp;

            for (let i = 0; i < n; i++) {
                const eqPoint = strategies[i].result.equityCurve[t];
                const initStratCap = strategies[i].result.initialCapital || 10000;
                const stratEq = eqPoint.equity || initStratCap;
                const stratGrowth = stratEq / initStratCap;
                totalEq += allocations[i].allocatedCapital * stratGrowth;
            }

            if (totalEq > portfolioPeak) {
                portfolioPeak = totalEq;
            }
            const dd = portfolioPeak > 0 ? ((portfolioPeak - totalEq) / portfolioPeak) * 100 : 0;
            if (dd > portfolioMaxDd) {
                portfolioMaxDd = dd;
            }

            const eqPct = ((totalEq - totalCapital) / totalCapital) * 100;
            portfolioCurve.push({
                timestamp: ts,
                equityPercent: Number(eqPct.toFixed(4)),
                equity: Number(totalEq.toFixed(2)),
                drawdownPercent: Number(dd.toFixed(4)),
                drawdown: Number((portfolioPeak - totalEq).toFixed(2)),
            });
        }

        const lastPoint = portfolioCurve.length > 0 ? portfolioCurve[portfolioCurve.length - 1] : undefined;
        const finalPortfolioEq = (lastPoint && typeof lastPoint.equity === 'number') ? lastPoint.equity : totalCapital;
        const portfolioReturnPct = Number((((finalPortfolioEq - totalCapital) / totalCapital) * 100).toFixed(2));

        // Calculate Portfolio Sharpe and Sortino from periodic portfolio returns
        const portfolioPeriodicReturns: number[] = [];
        for (let k = 1; k < portfolioCurve.length; k++) {
            const p0 = portfolioCurve[k - 1].equity || totalCapital;
            const p1 = portfolioCurve[k].equity || totalCapital;
            portfolioPeriodicReturns.push((p1 - p0) / p0);
        }

        let pSharpe = 0;
        let pSortino = 0;
        if (portfolioPeriodicReturns.length > 1) {
            const meanR = portfolioPeriodicReturns.reduce((a, b) => a + b, 0) / portfolioPeriodicReturns.length;
            const varSum = portfolioPeriodicReturns.reduce((acc, r) => acc + Math.pow(r - meanR, 2), 0);
            const stdDev = Math.sqrt(varSum / (portfolioPeriodicReturns.length - 1));

            const downRets = portfolioPeriodicReturns.filter(r => r < 0);
            const downVarSum = downRets.reduce((acc, r) => acc + Math.pow(r, 2), 0);
            const downStdDev = downRets.length > 0 ? Math.sqrt(downVarSum / downRets.length) : stdDev;

            // Annualization factor (~105,120 5m bars per year)
            const annFactor = Math.sqrt(105120);
            pSharpe = stdDev > 0 ? (meanR / stdDev) * annFactor : 0;
            pSortino = downStdDev > 0 ? (meanR / downStdDev) * annFactor : pSharpe;
        }

        // Weighted component max drawdown vs realized portfolio max drawdown
        let weightedCompDd = 0;
        for (let i = 0; i < n; i++) {
            weightedCompDd += (allocations[i].weightPercent / 100) * (strategies[i].result.maxDrawdownPercent || 0);
        }

        const divBenefit = weightedCompDd > 0
            ? Math.max(0, ((weightedCompDd - portfolioMaxDd) / weightedCompDd) * 100)
            : 0;

        return {
            totalCapital,
            allocationModel: model,
            strategyAllocations: allocations,
            cashReservePercent: actualCashPct,
            cashReserveAmount: actualCashDollars,
            portfolioReturnPercent: portfolioReturnPct,
            portfolioSharpe: Number(pSharpe.toFixed(2)),
            portfolioSortino: Number(pSortino.toFixed(2)),
            portfolioMaxDrawdownPercent: Number(portfolioMaxDd.toFixed(2)),
            weightedComponentDrawdownPercent: Number(weightedCompDd.toFixed(2)),
            diversificationBenefitPercent: Number(divBenefit.toFixed(1)),
            portfolioEquityCurve: portfolioCurve,
            clusterWeights: clusterMap,
        };
    }
}
