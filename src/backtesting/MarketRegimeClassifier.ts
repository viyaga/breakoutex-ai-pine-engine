// ================================================================
// BreakoutEx AI — Market Regime Classifier & Live Condition Analyzer
//
// Classifies historical bars into market regimes, evaluates strategy edge
// strictly inside its target market conditions vs out-of-regime risk,
// and detects the current active live market regime for deployment.
// ================================================================

import {
    Candle,
} from '../config/types';

import {
    PineStrategyDefinition,
} from '../pine/strategy-library';

import {
    BacktestTrade,
} from './types';

import {
    IndicatorEngine,
} from './IndicatorEngine';

export type MarketRegime =
    | 'trending_bullish'
    | 'trending_bearish'
    | 'low_volatility_consolidation'
    | 'high_volatility_breakout'
    | 'mean_reverting_range'
    | 'extreme_volatility'
    | 'neutral';

export interface RegimePerformanceStats {
    regime: MarketRegime;
    barCount: number;
    barPercentage: number;
    tradeCount: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    netProfitPercent: number;
    profitFactor: number;
    expectancyPercent: number;
    isTargetCondition: boolean;
    suitabilityScore: number; // 0 - 100 for this strategy in this regime
}

export interface CurrentMarketRegimeReport {
    currentRegime: MarketRegime;
    regimeConfidence: number; // 0 - 100
    timestamp: number;
    metrics: {
        price: number;
        adx: number;
        atrRatio: number; // current ATR / 50-SMA of ATR
        bbWidthPercent: number;
        trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    };
    recommendedStrategyCharacteristics: string[];
}

export interface RegimeAnalysisResult {
    strategyId: string;
    totalTrades: number;
    dominantMarketRegime: MarketRegime;
    regimeBreakdown: RegimePerformanceStats[];

    // Separated Strategy Edge vs Market Fit
    targetConditionWinRate: number;
    targetConditionProfitFactor: number;
    intrinsicQualityScore: number; // 0 - 100: Edge when trading in intended conditions

    nonTargetConditionWinRate: number;
    outOfRegimeRiskScore: number; // 0 - 100: Drawdown / bleed risk outside intended conditions

    regimeAlignmentScore: number; // 0 - 100: Overall alignment
    regimeSuitabilityMap: Record<MarketRegime, number>; // 0 - 100 suitability per regime
}

export class MarketRegimeClassifier {

    /**
     * Classify an array of historical candles into bar-by-bar regimes.
     */
    static classify(candles: Candle[]): MarketRegime[] {
        const length = candles.length;
        if (length === 0) return [];

        const engine = new IndicatorEngine(candles);
        const ema50 = engine.ema(50, 'close');
        const ema200 = engine.ema(200, 'close');
        const adx = engine.adx(14);
        const atr = engine.atr(14);
        const bb = engine.bbands(20, 2, 'close');

        // Precompute ATR baseline (SMA 50 of ATR)
        const atrSma50 = new Array<number>(length);
        let atrSum = 0;
        for (let i = 0; i < length; i++) {
            atrSum += atr[i] || 0;
            if (i >= 50) atrSum -= atr[i - 50] || 0;
            atrSma50[i] = i >= 49 ? atrSum / 50 : atr[i] || 0;
        }

        const regimes: MarketRegime[] = new Array(length);

        for (let i = 0; i < length; i++) {
            const c = candles[i];
            const p = c.close;
            const e50 = ema50[i];
            const e200 = ema200[i];
            const currentAdx = adx.adx[i] || 20;
            const currentAtr = atr[i] || 1;
            const avgAtr = atrSma50[i] || currentAtr;
            const bbUpper = bb.upper[i];
            const bbLower = bb.lower[i];
            const bbWidth = bbUpper > 0 ? (bbUpper - bbLower) / bb.middle[i] : 0.02;

            if (currentAtr > avgAtr * 2.0) {
                regimes[i] = 'extreme_volatility';
            } else if (currentAtr > avgAtr * 1.3 && currentAdx > 22) {
                regimes[i] = 'high_volatility_breakout';
            } else if (p > e50 && e50 > e200 && currentAdx > 22) {
                regimes[i] = 'trending_bullish';
            } else if (p < e50 && e50 < e200 && currentAdx > 22) {
                regimes[i] = 'trending_bearish';
            } else if (bbWidth < 0.015 && currentAdx < 20) {
                regimes[i] = 'low_volatility_consolidation';
            } else if (currentAdx < 22) {
                regimes[i] = 'mean_reverting_range';
            } else {
                regimes[i] = 'neutral';
            }
        }

        return regimes;
    }

    /**
     * Detect the active market regime right now on the latest candles.
     */
    static detectCurrentRegime(candles: Candle[]): CurrentMarketRegimeReport {
        if (!candles || candles.length < 50) {
            return {
                currentRegime: 'neutral',
                regimeConfidence: 50,
                timestamp: candles && candles.length > 0 ? candles[candles.length - 1].timestamp : Date.now(),
                metrics: {
                    price: candles && candles.length > 0 ? candles[candles.length - 1].close : 0,
                    adx: 20,
                    atrRatio: 1.0,
                    bbWidthPercent: 2.0,
                    trendDirection: 'NEUTRAL',
                },
                recommendedStrategyCharacteristics: ['Conservative risk', 'Multiframe confirmation'],
            };
        }

        const lastBar = candles[candles.length - 1];
        const regimes = MarketRegimeClassifier.classify(candles);
        const currentRegime = regimes[regimes.length - 1] || 'neutral';

        const engine = new IndicatorEngine(candles);
        const lastIdx = candles.length - 1;
        const ema50 = engine.ema(50, 'close')[lastIdx] || lastBar.close;
        const ema200 = engine.ema(200, 'close')[lastIdx] || lastBar.close;
        const adxVal = engine.adx(14).adx[lastIdx] || 20;
        const atrArr = engine.atr(14);
        const curAtr = atrArr[lastIdx] || 1;
        const avgAtr = atrArr.slice(Math.max(0, lastIdx - 50), lastIdx).reduce((a, b) => a + b, 0) / Math.min(50, lastIdx);
        const atrRatio = avgAtr > 0 ? curAtr / avgAtr : 1.0;
        const bb = engine.bbands(20, 2, 'close');
        const bbWidthPct = bb.middle[lastIdx] > 0 ? ((bb.upper[lastIdx] - bb.lower[lastIdx]) / bb.middle[lastIdx]) * 100 : 2.0;

        let trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
        if (lastBar.close > ema50 && ema50 > ema200) trendDirection = 'BULLISH';
        else if (lastBar.close < ema50 && ema50 < ema200) trendDirection = 'BEARISH';

        // Calculate Confidence based on agreement of multiple indicators
        let confidence = 60;
        if (currentRegime.startsWith('trending') && adxVal > 30) confidence += 25;
        if (currentRegime === 'high_volatility_breakout' && atrRatio > 1.5) confidence += 25;
        if (currentRegime === 'low_volatility_consolidation' && bbWidthPct < 1.2) confidence += 20;
        if (currentRegime === 'mean_reverting_range' && adxVal < 18) confidence += 20;
        const regimeConfidence = Math.min(98, confidence);

        const recommendations: string[] = [];
        if (currentRegime === 'trending_bullish') {
            recommendations.push('Trend-following pullbacks', 'Donchian upper breakouts', 'VWAP support bounces');
        } else if (currentRegime === 'trending_bearish') {
            recommendations.push('Trend-continuation shorts', 'Donchian lower breakdowns', 'VWAP resistance rejects');
        } else if (currentRegime === 'high_volatility_breakout') {
            recommendations.push('ATR expansion breakouts', 'Range breakout with volume expansion');
        } else if (currentRegime === 'mean_reverting_range' || currentRegime === 'low_volatility_consolidation') {
            recommendations.push('Bollinger Band mean reversion', 'Failed breakout fade (traps)', 'Support/resistance oscillator fades');
        } else {
            recommendations.push('Momentum exhaustion scalping', 'Conservative MTF trend confirmation');
        }

        return {
            currentRegime,
            regimeConfidence,
            timestamp: lastBar.timestamp,
            metrics: {
                price: lastBar.close,
                adx: Number(adxVal.toFixed(1)),
                atrRatio: Number(atrRatio.toFixed(2)),
                bbWidthPercent: Number(bbWidthPct.toFixed(2)),
                trendDirection,
            },
            recommendedStrategyCharacteristics: recommendations,
        };
    }

    /**
     * Analyze trade performance mapped against market regimes.
     */
    static analyze(
        strategy: PineStrategyDefinition,
        candles: Candle[],
        trades: BacktestTrade[]
    ): RegimeAnalysisResult {
        const regimes = MarketRegimeClassifier.classify(candles);
        const targetConditions = new Set<string>(strategy.bestMarketConditions || []);

        const regimeBarCounts: Record<MarketRegime, number> = {
            trending_bullish: 0,
            trending_bearish: 0,
            low_volatility_consolidation: 0,
            high_volatility_breakout: 0,
            mean_reverting_range: 0,
            extreme_volatility: 0,
            neutral: 0,
        };

        for (const r of regimes) {
            regimeBarCounts[r]++;
        }

        const regimeTrades: Record<MarketRegime, BacktestTrade[]> = {
            trending_bullish: [],
            trending_bearish: [],
            low_volatility_consolidation: [],
            high_volatility_breakout: [],
            mean_reverting_range: [],
            extreme_volatility: [],
            neutral: [],
        };

        for (const trade of trades) {
            const entryIdx = trade.entryBarIndex;
            const regime = (entryIdx >= 0 && entryIdx < regimes.length)
                ? regimes[entryIdx]
                : 'neutral';
            regimeTrades[regime].push(trade);
        }

        const totalBars = Math.max(1, candles.length);
        const breakdown: RegimePerformanceStats[] = [];
        const suitabilityMap: Record<MarketRegime, number> = {
            trending_bullish: 50,
            trending_bearish: 50,
            low_volatility_consolidation: 50,
            high_volatility_breakout: 50,
            mean_reverting_range: 50,
            extreme_volatility: 50,
            neutral: 50,
        };

        let targetWins = 0;
        let targetTotal = 0;
        let targetGrossProfit = 0;
        let targetGrossLoss = 0;

        let nonTargetWins = 0;
        let nonTargetTotal = 0;
        let nonTargetGrossProfit = 0;
        let nonTargetGrossLoss = 0;

        let maxBarsRegime: MarketRegime = 'neutral';
        let maxBarsCount = -1;

        const allRegimes: MarketRegime[] = [
            'trending_bullish',
            'trending_bearish',
            'high_volatility_breakout',
            'low_volatility_consolidation',
            'mean_reverting_range',
            'extreme_volatility',
        ];

        for (const r of allRegimes) {
            const barCount = regimeBarCounts[r];
            if (barCount > maxBarsCount) {
                maxBarsCount = barCount;
                maxBarsRegime = r;
            }

            const tList = regimeTrades[r];
            const wins = tList.filter(t => (t.netPnlPercent ?? 0) > 0).length;
            const losses = tList.filter(t => (t.netPnlPercent ?? 0) < 0).length;
            const winRate = tList.length > 0 ? (wins / tList.length) * 100 : 0;

            let grossProfit = 0;
            let grossLoss = 0;
            let netProfitPct = 0;

            for (const t of tList) {
                const ret = t.netPnlPercent ?? 0;
                netProfitPct += ret;
                if (ret > 0) grossProfit += ret;
                else grossLoss += Math.abs(ret);
            }

            const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 99 : 1);
            const expectancy = tList.length > 0 ? netProfitPct / tList.length : 0;
            const isTarget = targetConditions.has(r);

            if (isTarget) {
                targetWins += wins;
                targetTotal += tList.length;
                targetGrossProfit += grossProfit;
                targetGrossLoss += grossLoss;
            } else {
                nonTargetWins += wins;
                nonTargetTotal += tList.length;
                nonTargetGrossProfit += grossProfit;
                nonTargetGrossLoss += grossLoss;
            }

            // Regime Suitability Calculation (0 - 100)
            let suitability = 50;
            if (isTarget) suitability += 15;
            if (winRate >= 55) suitability += 20;
            else if (winRate >= 45) suitability += 10;
            else if (winRate < 35) suitability -= 15;

            if (profitFactor >= 1.5) suitability += 15;
            else if (profitFactor < 1.0) suitability -= 15;

            suitability = Math.max(0, Math.min(100, suitability));
            suitabilityMap[r] = suitability;

            breakdown.push({
                regime: r,
                barCount,
                barPercentage: Number(((barCount / totalBars) * 100).toFixed(1)),
                tradeCount: tList.length,
                winningTrades: wins,
                losingTrades: losses,
                winRate: Number(winRate.toFixed(2)),
                netProfitPercent: Number(netProfitPct.toFixed(2)),
                profitFactor: Number(profitFactor.toFixed(2)),
                expectancyPercent: Number(expectancy.toFixed(2)),
                isTargetCondition: isTarget,
                suitabilityScore: suitability,
            });
        }

        const targetWinRate = targetTotal > 0 ? (targetWins / targetTotal) * 100 : 0;
        const targetPf = targetGrossLoss > 0 ? targetGrossProfit / targetGrossLoss : (targetGrossProfit > 0 ? 5 : 1);

        const nonTargetWinRate = nonTargetTotal > 0 ? (nonTargetWins / nonTargetTotal) * 100 : 0;
        const nonTargetNet = nonTargetGrossProfit - nonTargetGrossLoss;

        // Intrinsic Quality Score (Edge strictly in target regime)
        let intrinsicScore = 50;
        if (targetTotal >= 5) {
            if (targetWinRate >= 55) intrinsicScore += 25;
            else if (targetWinRate >= 45) intrinsicScore += 15;
            else intrinsicScore -= 15;

            if (targetPf >= 1.7) intrinsicScore += 25;
            else if (targetPf >= 1.2) intrinsicScore += 15;
            else intrinsicScore -= 15;
        } else {
            intrinsicScore = 55; // neutral if insufficient regime trades
        }
        const intrinsicQualityScore = Math.max(0, Math.min(100, intrinsicScore));

        // Out-of-Regime Bleed Risk
        let bleedRisk = 30;
        if (nonTargetTotal > 0) {
            if (nonTargetNet < -10) bleedRisk += 40;
            else if (nonTargetNet < 0) bleedRisk += 20;
            else bleedRisk -= 10;
        }
        const outOfRegimeRiskScore = Math.max(0, Math.min(100, bleedRisk));

        // Overall Alignment Score
        let alignScore = 50;
        if (targetTotal > 0) {
            if (targetWinRate >= nonTargetWinRate) alignScore += 25;
            if (targetPf > 1.3) alignScore += 25;
        }

        return {
            strategyId: strategy.id,
            totalTrades: trades.length,
            dominantMarketRegime: maxBarsRegime,
            regimeBreakdown: breakdown,
            targetConditionWinRate: Number(targetWinRate.toFixed(2)),
            targetConditionProfitFactor: Number(targetPf.toFixed(2)),
            intrinsicQualityScore,
            nonTargetConditionWinRate: Number(nonTargetWinRate.toFixed(2)),
            outOfRegimeRiskScore,
            regimeAlignmentScore: Math.max(0, Math.min(100, alignScore)),
            regimeSuitabilityMap: suitabilityMap,
        };
    }
}
