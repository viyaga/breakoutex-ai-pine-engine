// ================================================================
// AI Market Evaluator — Evaluates market regimes every 6 hours
// and dynamically assigns the optimal strategy from the Strategy Library.
// ================================================================

import env from '../config/env';
import { PineBotConfig, Candle } from '../config/types';
import { getStrategyById, getStrategyCatalogForAi, STRATEGY_LIBRARY } from '../pine/strategy-library';
import * as ind from '../pine/indicators';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// In-memory evaluation cache to guarantee strict 6-hour interval per bot
const evaluationCache = new Map<string, { lastEvaluationTs: number; strategyId: string }>();

interface AiMarketEvaluationResponse {
    marketCondition: 'trending_bullish' | 'trending_bearish' | 'ranging_choppy' | 'high_volatility_breakout' | 'low_volatility_consolidation';
    confidence: 'high' | 'medium' | 'low';
    selectedStrategyId: string;
    strategyName: string;
    reasoning: string;
    recommendedTimeframe: string;
    recommendedTp: number;
    recommendedSl: number;
}

/** Compute market indicators from candle series */
function computeMarketSnapshot(candles: Candle[]) {
    if (!candles || candles.length < 20) {
        return {
            currentPrice: candles[candles.length - 1]?.close ?? 0,
            change24h: 0,
            rsi: 50,
            emaTrend: 'neutral' as const,
            atr: 0,
            atrPercent: 0,
            volatilityLevel: 'medium' as const,
        };
    }

    const n = candles.length;
    const currentPrice = candles[n - 1].close;
    const closes = candles.map(c => c.close);

    // Approximate 24h change from available bars
    const firstClose = candles[0].close;
    const change24h = Number((((currentPrice - firstClose) / firstClose) * 100).toFixed(2));

    // RSI
    const rsiSeries = ind.rsi(closes, 14);
    const lastRsi = Number((rsiSeries[n - 1] || 50).toFixed(1));

    // EMA Trend
    const ema50Series = ind.ema(closes, Math.min(50, Math.floor(n / 2)));
    const lastEma50 = ema50Series[n - 1] || currentPrice;
    const emaTrend = currentPrice > lastEma50 * 1.002 ? 'bullish' : currentPrice < lastEma50 * 0.998 ? 'bearish' : 'neutral';

    // ATR
    const atrSeries = ind.atr(candles, 14);
    const lastAtr = atrSeries[n - 1] || 0;
    const atrPercent = currentPrice > 0 ? Number(((lastAtr / currentPrice) * 100).toFixed(2)) : 0;

    let volatilityLevel: 'low' | 'medium' | 'high' = 'medium';
    if (atrPercent > 1.5) volatilityLevel = 'high';
    else if (atrPercent < 0.5) volatilityLevel = 'low';

    return {
        currentPrice,
        change24h,
        rsi: lastRsi,
        emaTrend,
        atr: Number(lastAtr.toFixed(4)),
        atrPercent,
        volatilityLevel,
    };
}

/** Check if bot is due for an AI evaluation (strictly once per 6 hours) */
export function isAiEvaluationDue(bot: PineBotConfig): boolean {
    if (!bot.IS_AI_MANAGED) return false;

    const cached = evaluationCache.get(bot.id);
    if (cached && Date.now() - cached.lastEvaluationTs < SIX_HOURS_MS) {
        return false;
    }

    if (bot.LAST_AI_EVALUATION) {
        const lastEvalTs = new Date(bot.LAST_AI_EVALUATION).getTime();
        if (!isNaN(lastEvalTs) && Date.now() - lastEvalTs < SIX_HOURS_MS) {
            // Populate cache if not already in memory
            if (!cached) {
                evaluationCache.set(bot.id, {
                    lastEvaluationTs: lastEvalTs,
                    strategyId: bot.CURRENT_STRATEGY_ID || 'mtf_bullish_trend_pullback',
                });
            }
            return false;
        }
    }

    return true;
}

/** Call Backend AI API and apply selected strategy */
export async function evaluateAndApplyAiStrategy(
    bot: PineBotConfig,
    candles: Candle[]
): Promise<void> {
    const botId = bot.id;
    const symbol = bot.SYMBOL;

    console.log(`[AI MarketEvaluator][${botId}] ── Triggering 6-Hour AI Market Analysis for ${symbol} ──`);

    const marketSnapshot = computeMarketSnapshot(candles);
    const catalog = getStrategyCatalogForAi();

    let aiResult: AiMarketEvaluationResponse | null = null;

    try {
        const url = `${env.payloadUrl}/api/ai/evaluate-market-strategy`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                symbol,
                exchange: bot.EXCHANGE,
                tradingMode: bot.MODE,
                minRR: bot.MIN_RR,
                minScore: bot.MIN_SCORE,
                ...marketSnapshot,
                availableStrategies: catalog,
            }),
            signal: AbortSignal.timeout(20_000),
        });

        if (res.ok) {
            aiResult = (await res.json()) as AiMarketEvaluationResponse;
        } else {
            console.warn(`[AI MarketEvaluator][${botId}] AI API responded with ${res.status}: ${res.statusText}`);
        }
    } catch (err: any) {
        console.error(`[AI MarketEvaluator][${botId}] Failed to call AI API:`, err?.message ?? err);
    }

    // Fallback if AI API fails or is unreachable
    if (!aiResult || !aiResult.selectedStrategyId) {
        console.log(`[AI MarketEvaluator][${botId}] Using market rule fallback for strategy selection`);
        const isBull = marketSnapshot.change24h > 1 || (marketSnapshot.rsi > 55 && marketSnapshot.emaTrend === 'bullish');
        const isBear = marketSnapshot.change24h < -1 || (marketSnapshot.rsi < 45 && marketSnapshot.emaTrend === 'bearish');

        let fallbackId = 'mtf_bollinger_mean_reversion';
        let fallbackCond: AiMarketEvaluationResponse['marketCondition'] = 'ranging_choppy';

        if (marketSnapshot.volatilityLevel === 'high') {
            fallbackId = 'mtf_volatility_squeeze_breakout';
            fallbackCond = 'high_volatility_breakout';
        } else if (isBull) {
            fallbackId = 'mtf_bullish_trend_pullback';
            fallbackCond = 'trending_bullish';
        } else if (isBear) {
            fallbackId = 'mtf_bearish_breakdown';
            fallbackCond = 'trending_bearish';
        }

        const strat = getStrategyById(fallbackId) || STRATEGY_LIBRARY.mtf_bullish_trend_pullback;
        aiResult = {
            marketCondition: fallbackCond,
            confidence: 'medium',
            selectedStrategyId: strat.id,
            strategyName: strat.name,
            reasoning: `Selected ${strat.name} based on technical indicators (24h: ${marketSnapshot.change24h}%, RSI: ${marketSnapshot.rsi}, ATR: ${marketSnapshot.atrPercent}%).`,
            recommendedTimeframe: strat.recommendedTimeframe,
            recommendedTp: strat.defaultTpPercent,
            recommendedSl: strat.defaultSlPercent,
        };
    }

    // Apply selected strategy from library
    const selectedStrat = getStrategyById(aiResult.selectedStrategyId) || STRATEGY_LIBRARY.mtf_bullish_trend_pullback;

    const now = new Date();
    const nextEval = new Date(now.getTime() + SIX_HOURS_MS);

    // Mutate runtime config for this cycle
    bot.PINE_SCRIPT = selectedStrat.pineScript;
    bot.TIMEFRAME = aiResult.recommendedTimeframe || selectedStrat.recommendedTimeframe;
    bot.TP_PERCENT = aiResult.recommendedTp || selectedStrat.defaultTpPercent;
    bot.SL_PERCENT = aiResult.recommendedSl || selectedStrat.defaultSlPercent;
    bot.CURRENT_STRATEGY_ID = selectedStrat.id;
    bot.MARKET_CONDITION = aiResult.marketCondition;
    bot.AI_REASONING = aiResult.reasoning;
    bot.LAST_AI_EVALUATION = now.toISOString();
    bot.NEXT_AI_EVALUATION = nextEval.toISOString();

    // Cache locally
    evaluationCache.set(botId, {
        lastEvaluationTs: now.getTime(),
        strategyId: selectedStrat.id,
    });

    console.log(`[AI MarketEvaluator][${botId}] ✓ AI Selected Strategy: "${selectedStrat.name}" [${selectedStrat.id}] | Regime: ${aiResult.marketCondition} | Next Eval: ${nextEval.toISOString()}`);

    // Persist asynchronously back to backend/CMS
    persistAiEvaluation(botId, {
        strategyId: selectedStrat.id,
        strategyName: selectedStrat.name,
        marketCondition: aiResult.marketCondition,
        aiReasoning: aiResult.reasoning,
        lastAiEvaluation: now.toISOString(),
        nextAiEvaluation: nextEval.toISOString(),
        pineScript: selectedStrat.pineScript,
        timeframe: bot.TIMEFRAME,
        tpPercent: bot.TP_PERCENT,
        slPercent: bot.SL_PERCENT,
    }).catch(err => {
        console.warn(`[AI MarketEvaluator][${botId}] Failed to persist AI strategy to backend:`, err?.message ?? err);
    });
}

/** Persist AI strategy selection to Backend Payload CMS */
async function persistAiEvaluation(botId: string, data: any): Promise<void> {
    const url = `${env.payloadUrl}/api/trading-bots/update-ai-strategy`;
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            botId,
            ...data,
        }),
        signal: AbortSignal.timeout(10_000),
    });
}
