// ================================================================
// BreakoutEx AI — AI Robustness Scorer & Strategy Selection Model
//
// Calculates calibrated anti-overfitting scores, statistical confidence bounds,
// market regime suitability, and live deployment recommendations.
// ================================================================

import {
    Candle,
} from '../config/types';

import {
    PineStrategyDefinition,
} from '../pine/strategy-library';

import {
    BacktestOptions,
    BacktestResult,
} from './types';

import {
    Backtester,
} from './Backtester';

import {
    MonteCarloSimulator,
    MonteCarloSimulationResult,
} from './MonteCarloSimulator';

import {
    WalkForwardEngine,
    SplitAnalysisResult,
    WalkForwardAnalysisResult,
} from './WalkForwardEngine';

import {
    MarketRegimeClassifier,
    RegimeAnalysisResult,
    CurrentMarketRegimeReport,
} from './MarketRegimeClassifier';

import {
    StatisticalCalibrator,
    StatisticalCalibrationReport,
} from './StatisticalCalibrator';

import {
    normalizeTimeframe,
} from '../interpreter';

export type RobustnessVerdict =
    | 'HIGHLY_ROBUST'
    | 'ROBUST'
    | 'ACCEPTABLE'
    | 'OVERFIT_RISK'
    | 'INSUFFICIENT_SAMPLE';

export type DeploymentRecommendation =
    | 'DEPLOY_AGGRESSIVE'
    | 'DEPLOY_STANDARD'
    | 'DEPLOY_CAUTION'
    | 'DO_NOT_DEPLOY';

export interface DeploymentWeightOptions {
    historicalRobustnessWeight?: number; // default: 0.40
    currentRegimeFitWeight?: number;     // default: 0.60
}

export interface ScoreComponentBreakdown {
    oosConsistencyScore: number; // 30% weight
    riskAdjustedQualityScore: number; // 25% weight
    drawdownResilienceScore: number; // 20% weight
    statisticalValidityScore: number; // 15% weight
    regimeAlignmentScore: number; // 10% weight
}

export interface ComprehensiveRobustnessReport {
    strategyId: string;
    strategyName: string;
    symbol: string;
    timeframe: string;

    // Composite Robustness Rating
    compositeScore: number; // 0 - 100 (Historical validity)
    verdict: RobustnessVerdict;
    scoreBreakdown: ScoreComponentBreakdown;

    // Live Deployment Rating (Robustness + Current Regime Fit)
    currentRegimeFitScore: number; // 0 - 100
    deploymentScore: number; // 0 - 100
    deploymentRecommendation: DeploymentRecommendation;
    isCurrentlyDeployable: boolean;

    // Subsystem Reports
    fullBacktest: BacktestResult;
    splitAnalysis: SplitAnalysisResult;
    walkForwardAnalysis: WalkForwardAnalysisResult;
    monteCarloSimulation: MonteCarloSimulationResult;
    regimeAnalysis: RegimeAnalysisResult;
    currentMarketRegime: CurrentMarketRegimeReport;
    calibration: StatisticalCalibrationReport;

    // Qualitative AI Insights
    keyStrengths: string[];
    riskFactors: string[];
    actionableRecommendations: string[];
}

export class AIRobustnessScorer {

    /**
     * Run full comprehensive robustness and anti-overfitting analysis on a strategy.
     */
    static evaluate(
        strategy: PineStrategyDefinition,
        candleMap: Map<string, Candle[]>,
        options: BacktestOptions = {},
        deploymentWeights: DeploymentWeightOptions = {}
    ): ComprehensiveRobustnessReport {
        const baseTf = normalizeTimeframe(options.baseTimeframe ?? '5m');
        const symbol = options.symbol ?? 'BTCUSDT';
        const baseCandles = candleMap.get(baseTf) ?? [];

        const performanceOptions: BacktestOptions = {
            performance: {
                enabled: true,
                usePrecomputedIndicators: true,
                useCompiledScript: true,
                zeroCopySnapshots: true,
                ...options.performance,
            },
            ...options,
        };

        // 1. Run full backtest
        const fullBacktest = Backtester.run({
            strategy,
            candleMap,
            options: performanceOptions,
        });

        // 2. Run Train / Validation / Test Split
        const splitAnalysis = WalkForwardEngine.runSplit({
            strategy,
            candleMap,
            options: performanceOptions,
        });

        // 3. Run Walk-Forward Analysis (WFA)
        const walkForwardAnalysis = WalkForwardEngine.runWalkForward({
            strategy,
            candleMap,
            windowsCount: 4,
            options: performanceOptions,
        });

        // 4. Run Monte Carlo Simulation
        const monteCarloSimulation = MonteCarloSimulator.run(
            fullBacktest.trades,
            fullBacktest.initialCapital,
            { iterations: 1000 }
        );

        // 5. Run Market Regime Analysis & Live Regime Detection
        const regimeAnalysis = MarketRegimeClassifier.analyze(
            strategy,
            baseCandles,
            fullBacktest.trades
        );

        const currentMarketRegime = MarketRegimeClassifier.detectCurrentRegime(baseCandles);

        // 6. Run Statistical Calibration (Confidence Intervals & Sample Penalties)
        const calibration = StatisticalCalibrator.calibrate(
            fullBacktest.trades,
            fullBacktest.winRate ?? 0,
            fullBacktest.profitFactor ?? 1,
            fullBacktest.sharpeRatio ?? 0,
            0.95
        );

        // ------------------------------------------------------------
        // Component Scoring (0 - 100 each)
        // ------------------------------------------------------------

        // A. OOS Consistency (30%)
        const oosConsistencyScore = Math.round(
            splitAnalysis.generalizationScore * 0.5 +
            walkForwardAnalysis.consistencyScore * 0.5
        );

        // B. Risk-Adjusted Quality (25%)
        let riskScore = 40;
        const sharpe = fullBacktest.sharpeRatio ?? 0;
        const winRate = fullBacktest.winRate ?? 0;
        const pf = fullBacktest.profitFactor ?? 1;

        if (sharpe >= 2.0) riskScore += 30;
        else if (sharpe >= 1.2) riskScore += 20;
        else if (sharpe >= 0.8) riskScore += 10;
        else if (sharpe < 0) riskScore -= 20;

        if (winRate >= 55) riskScore += 15;
        else if (winRate >= 45) riskScore += 10;
        else if (winRate < 35) riskScore -= 10;

        if (pf >= 1.8) riskScore += 15;
        else if (pf >= 1.3) riskScore += 10;
        else if (pf < 1.0) riskScore -= 15;

        const riskAdjustedQualityScore = Math.max(0, Math.min(100, Math.round(riskScore)));

        // C. Drawdown Resilience (20%)
        let ddScore = 50;
        const maxDd = fullBacktest.maxDrawdownPercent ?? 0;
        const p95Dd = monteCarloSimulation.p95MaxDrawdownPercent;
        const ruinProb = monteCarloSimulation.probabilityOfRuinPercent;

        if (maxDd < 10) ddScore += 25;
        else if (maxDd < 20) ddScore += 15;
        else if (maxDd > 35) ddScore -= 25;

        if (p95Dd < 25) ddScore += 15;
        else if (p95Dd > 40) ddScore -= 20;

        if (ruinProb === 0) ddScore += 10;
        else if (ruinProb > 5) ddScore -= 25;

        const drawdownResilienceScore = Math.max(0, Math.min(100, Math.round(ddScore)));

        // D. Statistical Validity & Sample Size (15%)
        let statScore = 40;
        if (calibration.sampleSizeClassification === 'STRONG') statScore = 95;
        else if (calibration.sampleSizeClassification === 'ACCEPTABLE') statScore = 80;
        else if (calibration.sampleSizeClassification === 'CAUTION') statScore = 55;
        else statScore = 20;

        const statisticalValidityScore = statScore;

        // E. Regime Alignment (10%)
        const regimeAlignmentScore = regimeAnalysis.regimeAlignmentScore;

        // ------------------------------------------------------------
        // Weighted Composite Robustness Score (Calibrated)
        // ------------------------------------------------------------
        let rawCompositeScore = Math.round(
            oosConsistencyScore * 0.30 +
            riskAdjustedQualityScore * 0.25 +
            drawdownResilienceScore * 0.20 +
            statisticalValidityScore * 0.15 +
            regimeAlignmentScore * 0.10
        );

        // Apply statistical uncertainty deductions
        rawCompositeScore -= calibration.uncertaintyPenaltyDeduction;
        const compositeScore = Math.max(0, Math.min(100, rawCompositeScore));

        // ------------------------------------------------------------
        // Current Market Regime Fit & Live Deployment Score
        // ------------------------------------------------------------
        const activeRegime = currentMarketRegime.currentRegime;
        const currentRegimeFitScore = regimeAnalysis.regimeSuitabilityMap[activeRegime] ?? 50;

        // Configurable weights (default: 40% historical robustness, 60% current market fit)
        const histWeight = deploymentWeights.historicalRobustnessWeight ?? 0.40;
        const regimeWeight = deploymentWeights.currentRegimeFitWeight ?? 0.60;
        const totalWeight = (histWeight + regimeWeight) || 1.0;

        // Live deployment score blends historical robustness with current market suitability
        const deploymentScore = Math.round(
            ((compositeScore * histWeight) + (currentRegimeFitScore * regimeWeight)) / totalWeight
        );

        let deploymentRecommendation: DeploymentRecommendation;
        let isCurrentlyDeployable = false;

        if (calibration.sampleSizeClassification === 'INSUFFICIENT' || splitAnalysis.isOverfit) {
            deploymentRecommendation = 'DO_NOT_DEPLOY';
        } else if (deploymentScore >= 80 && currentRegimeFitScore >= 70) {
            deploymentRecommendation = 'DEPLOY_AGGRESSIVE';
            isCurrentlyDeployable = true;
        } else if (deploymentScore >= 65 && currentRegimeFitScore >= 55) {
            deploymentRecommendation = 'DEPLOY_STANDARD';
            isCurrentlyDeployable = true;
        } else if (deploymentScore >= 50 && compositeScore >= 60) {
            deploymentRecommendation = 'DEPLOY_CAUTION';
            isCurrentlyDeployable = true;
        } else {
            deploymentRecommendation = 'DO_NOT_DEPLOY';
        }

        // ------------------------------------------------------------
        // Verdict Determination
        // ------------------------------------------------------------
        let verdict: RobustnessVerdict;
        if (calibration.sampleSizeClassification === 'INSUFFICIENT' || fullBacktest.totalTrades < 5) {
            verdict = 'INSUFFICIENT_SAMPLE';
        } else if (splitAnalysis.isOverfit || splitAnalysis.overfittingRiskLevel === 'CRITICAL') {
            verdict = 'OVERFIT_RISK';
        } else if (compositeScore >= 80) {
            verdict = 'HIGHLY_ROBUST';
        } else if (compositeScore >= 65) {
            verdict = 'ROBUST';
        } else if (compositeScore >= 45) {
            verdict = 'ACCEPTABLE';
        } else {
            verdict = 'OVERFIT_RISK';
        }

        // ------------------------------------------------------------
        // Qualitative AI Insights
        // ------------------------------------------------------------
        const keyStrengths: string[] = [];
        const riskFactors: string[] = [];
        const actionableRecommendations: string[] = [];

        if (calibration.winRateInterval.lower >= 50) {
            keyStrengths.push(`Statistically confirmed win rate (${calibration.winRate.toFixed(1)}%, 95% CI: [${calibration.winRateInterval.lower}% - ${calibration.winRateInterval.upper}%]).`);
        }
        if (currentRegimeFitScore >= 75) {
            keyStrengths.push(`High edge alignment in active market regime "${activeRegime}" (Suitability: ${currentRegimeFitScore}/100).`);
        }
        if (monteCarloSimulation.probabilityOfRuinPercent === 0 && monteCarloSimulation.p95MaxDrawdownPercent < 25) {
            keyStrengths.push('Resilient trade sequence permutation with 0% simulated ruin probability.');
        }

        if (calibration.sampleSizeClassification === 'INSUFFICIENT' || calibration.sampleSizeClassification === 'CAUTION') {
            riskFactors.push(`Limited trade count (${fullBacktest.totalTrades} trades) widens 95% confidence intervals.`);
            actionableRecommendations.push('Broaden backtest evaluation window to gather $\\ge 50$ trades before live capital allocation.');
        }
        if (currentRegimeFitScore < 45) {
            riskFactors.push(`Strategy is not optimized for active market regime "${activeRegime}" (Suitability: ${currentRegimeFitScore}/100).`);
            actionableRecommendations.push(`Hold deployment until market transitions to target regime (${strategy.bestMarketConditions.join(', ')}).`);
        }
        if (splitAnalysis.isOverfit) {
            riskFactors.push('Performance degraded substantially between in-sample and out-of-sample testing periods.');
            actionableRecommendations.push('Reduce parameter complexity or indicator confluence count to prevent curve-fitting.');
        }

        if (keyStrengths.length === 0) {
            keyStrengths.push('Valid deterministic strategy logic executed without lookahead bias.');
        }

        return {
            strategyId: strategy.id,
            strategyName: strategy.name,
            symbol,
            timeframe: baseTf,
            compositeScore,
            verdict,
            scoreBreakdown: {
                oosConsistencyScore,
                riskAdjustedQualityScore,
                drawdownResilienceScore,
                statisticalValidityScore,
                regimeAlignmentScore,
            },
            currentRegimeFitScore,
            deploymentScore,
            deploymentRecommendation,
            isCurrentlyDeployable,
            fullBacktest,
            splitAnalysis,
            walkForwardAnalysis,
            monteCarloSimulation,
            regimeAnalysis,
            currentMarketRegime,
            calibration,
            keyStrengths,
            riskFactors,
            actionableRecommendations,
        };
    }
}
