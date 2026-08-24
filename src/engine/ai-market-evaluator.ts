import env from '../config/env';
import { PineBotConfig, Candle } from '../config/types';
import { getStrategyById, getStrategyCatalogForAi, STRATEGY_LIBRARY } from '../pine/strategy-library';
import * as ind from '../pine/indicators';
import { generateWithGemini } from '../ai/gemini-client';
import { backtestAllStrategies, BacktestResult } from '../pine/backtester';
import { normalizeTimeframe } from '../pine/interpreter';

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;


// In-memory evaluation cache to track interval and market volatility baseline
interface CacheEntry {
    lastEvaluationTs: number;
    strategyId: string;
    baselineAtr?: number;
    baselineEmaTrend?: 'bullish' | 'bearish' | 'neutral';
}
const evaluationCache = new Map<string, CacheEntry>();

export interface AiMarketEvaluationResponse {
    marketCondition: 'trending_bullish' | 'trending_bearish' | 'ranging_choppy' | 'high_volatility_breakout' | 'low_volatility_consolidation';
    confidence: 'high' | 'medium' | 'low';
    selectedStrategyId: string;
    strategyName: string;
    reasoning: string;
    recommendedTimeframe: string;
    recommendedTp: number;
    recommendedSl: number;
    standAside?: boolean;
}

/** Comprehensive Quantitative Snapshot calculation */
export function computeMarketSnapshot(candles: Candle[], htf1hCandles?: Candle[]) {
    if (!candles || candles.length < 20) {
        return {
            currentPrice: candles?.[candles.length - 1]?.close ?? 0,
            change24h: 0,
            rsi: 50,
            emaTrend: 'neutral' as const,
            atr: 0,
            atrPercent: 0,
            adx: 20,
            trendStrength: 'ranging_chop' as const,
            bbWidth: 0.02,
            isBbSqueeze: false,
            volumeRatio: 1.0,
            volatilityLevel: 'medium' as const,
            htf1hTrend: 'neutral' as const,
            htf1hRsi: 50,
        };
    }

    const n = candles.length;
    const currentPrice = candles[n - 1].close;
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);

    // 1. Price Change & Range
    const firstClose = candles[0].close;
    const change24h = Number((((currentPrice - firstClose) / firstClose) * 100).toFixed(2));

    // 2. RSI (14)
    const rsiSeries = ind.rsi(closes, 14);
    const lastRsi = Number((rsiSeries[n - 1] || 50).toFixed(1));

    // 3. EMAs (20, 50, 200)
    const ema20Series = ind.ema(closes, Math.min(20, n));
    const ema50Series = ind.ema(closes, Math.min(50, n));
    const lastEma20 = ema20Series[n - 1] || currentPrice;
    const lastEma50 = ema50Series[n - 1] || currentPrice;

    let emaTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (currentPrice > lastEma20 && lastEma20 > lastEma50) {
        emaTrend = 'bullish';
    } else if (currentPrice < lastEma20 && lastEma20 < lastEma50) {
        emaTrend = 'bearish';
    }

    // 4. ATR & Volatility
    const atrSeries = ind.atr(candles, 14);
    const lastAtr = atrSeries[n - 1] || 0;
    const atrPercent = currentPrice > 0 ? Number(((lastAtr / currentPrice) * 100).toFixed(2)) : 0;

    let volatilityLevel: 'low' | 'medium' | 'high' = 'medium';
    if (atrPercent > 1.5) volatilityLevel = 'high';
    else if (atrPercent < 0.5) volatilityLevel = 'low';

    // 5. ADX (Trend Strength vs Choppiness)
    const adxResult = ind.adx(candles, 14);
    const lastAdx = Number((adxResult.adx[n - 1] || 20).toFixed(1));
    const lastDiPlus = Number((adxResult.diPlus[n - 1] || 0).toFixed(1));
    const lastDiMinus = Number((adxResult.diMinus[n - 1] || 0).toFixed(1));

    let trendStrength: 'strong_trend' | 'moderate_trend' | 'ranging_chop' = 'ranging_chop';
    if (lastAdx >= 25) trendStrength = 'strong_trend';
    else if (lastAdx >= 20) trendStrength = 'moderate_trend';

    // 6. Bollinger Bands & Volatility Squeeze
    const bbResult = ind.bbands(closes, 20, 2);
    const lastBbWidth = Number((bbResult.width[n - 1] || 0.02).toFixed(4));
    // Squeeze detection: width is in bottom 25% of recent 50 bars
    const recentWidths = bbResult.width.slice(-50).filter(w => !isNaN(w));
    const minWidth = Math.min(...recentWidths, 0.01);
    const isBbSqueeze = lastBbWidth <= minWidth * 1.15;

    // 7. Volume Expansion
    const volSma = ind.sma(volumes, Math.min(20, n));
    const currentVol = volumes[n - 1] || 1;
    const avgVol = volSma[n - 1] || currentVol;
    const volumeRatio = Number((currentVol / Math.max(1, avgVol)).toFixed(2));

    // 8. Higher Timeframe Context (1h)
    let htf1hTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let htf1hRsi = 50;

    if (htf1hCandles && htf1hCandles.length >= 20) {
        const htfN = htf1hCandles.length;
        const htfCloses = htf1hCandles.map(c => c.close);
        const htfEma50 = ind.ema(htfCloses, Math.min(50, htfN));
        const lastHtfClose = htfCloses[htfN - 1];
        const lastHtfEma50 = htfEma50[htfN - 1] || lastHtfClose;

        htf1hTrend = lastHtfClose > lastHtfEma50 * 1.002 ? 'bullish' : lastHtfClose < lastHtfEma50 * 0.998 ? 'bearish' : 'neutral';
        const htfRsiSeries = ind.rsi(htfCloses, 14);
        htf1hRsi = Number((htfRsiSeries[htfN - 1] || 50).toFixed(1));
    }

    return {
        currentPrice,
        change24h,
        rsi: lastRsi,
        emaTrend,
        atr: Number(lastAtr.toFixed(4)),
        atrPercent,
        volatilityLevel,
        adx: lastAdx,
        diPlus: lastDiPlus,
        diMinus: lastDiMinus,
        trendStrength,
        bbWidth: lastBbWidth,
        isBbSqueeze,
        volumeRatio,
        htf1hTrend,
        htf1hRsi,
    };
}

/** Check if bot is due for an AI evaluation (scheduled 6h interval or dynamic regime shock) */
export function isAiEvaluationDue(
    bot: PineBotConfig,
    currentSnapshot?: ReturnType<typeof computeMarketSnapshot>
): boolean {
    if (!bot.IS_AI_MANAGED) return false;

    const cached = evaluationCache.get(bot.id);
    const now = Date.now();

    // 1. Time-based check (6 hours)
    let isTimeDue = true;
    if (cached && now - cached.lastEvaluationTs < SIX_HOURS_MS) {
        isTimeDue = false;
    } else if (bot.LAST_AI_EVALUATION) {
        const lastEvalTs = new Date(bot.LAST_AI_EVALUATION).getTime();
        if (!isNaN(lastEvalTs) && now - lastEvalTs < SIX_HOURS_MS) {
            isTimeDue = false;
        }
    }

    if (isTimeDue) return true;

    // 2. Event-Driven Regime Shock Invalidation:
    // If ATR suddenly expands > 2.2x baseline or trend abruptly flips against cached position
    if (cached && currentSnapshot) {
        if (cached.baselineAtr && currentSnapshot.atr > cached.baselineAtr * 2.2) {
            console.log(`[AI MarketEvaluator][${bot.id}] ⚡ Regime Shock Trigger: Volatility surged (ATR ${currentSnapshot.atr} vs base ${cached.baselineAtr})`);
            return true;
        }
        if (cached.baselineEmaTrend && cached.baselineEmaTrend !== 'neutral' && currentSnapshot.emaTrend !== 'neutral' && cached.baselineEmaTrend !== currentSnapshot.emaTrend) {
            console.log(`[AI MarketEvaluator][${bot.id}] ⚡ Regime Shift Trigger: EMA Trend flipped from ${cached.baselineEmaTrend} to ${currentSnapshot.emaTrend}`);
            return true;
        }
    }

    return false;
}

/** Evaluate market regime directly via Gemini AI and assign optimal strategy */

export async function evaluateAndApplyAiStrategy(
    bot: PineBotConfig,
    candles: Candle[],
    htfCandles?: Candle[]
): Promise<void> {
    const botId = bot.id;
    const symbol = bot.SYMBOL;
    const baseTf = bot.TIMEFRAME || '5m';

    console.log(`[AI MarketEvaluator][${botId}] ── Triggering Direct Gemini AI Market Analysis & Backtest for ${symbol} ──`);

    const snapshot = computeMarketSnapshot(candles, htfCandles);
    const catalog = getStrategyCatalogForAi();

    // 1. Run live in-memory backtest simulation on all candidate strategies
    const candleMap = new Map<string, Candle[]>();
    candleMap.set(normalizeTimeframe(baseTf), candles);
    if (htfCandles && htfCandles.length) {
        candleMap.set('1h', htfCandles);
    }

    const backtestResults = backtestAllStrategies(Object.values(STRATEGY_LIBRARY), candleMap, baseTf);
    const backtestLeaderboard = backtestResults.map((r, idx) =>
        `${idx + 1}. [${r.strategyId}] "${r.strategyName}": WinRate ${r.winRate}%, ProfitFactor ${r.profitFactor}, NetPnL ${r.netPnlPercent > 0 ? '+' : ''}${r.netPnlPercent}%, Trades: ${r.totalTrades} (Status: ${r.status.toUpperCase()})`
    ).join('\n');

    console.log(`[AI MarketEvaluator][${botId}] Live Backtest Top Performer: "${backtestResults[0]?.strategyName}" (NetPnL: ${backtestResults[0]?.netPnlPercent}%, WinRate: ${backtestResults[0]?.winRate}%)`);

    let aiResult: AiMarketEvaluationResponse | null = null;

    // Attempt direct Gemini API call
    if (env.geminiApiKey) {
        try {
            const systemPrompt = `You are BreakoutEx Quantitative Market Regime & Strategy Deductor.
Your task is to analyze real-time multi-timeframe technical indicators, market regime metrics, AND empirical in-memory backtest results on recent bars of ${symbol}, diagnose the exact market condition (regime), and select the SINGLE BEST strategy from the provided Strategy Library matching the user's risk preference (${bot.MODE} mode).

Strategy Catalog:
${catalog.map((s, idx) => `${idx + 1}. [${s.id}] "${s.name}": ${s.description} (Target Regimes: ${s.bestMarketConditions.join(', ')})`).join('\n')}

Rules:
1. marketCondition must be one of:
   - "trending_bullish": Strong uptrend (ADX >= 22, RSI > 52, Price > EMAs, +DI > -DI).
   - "trending_bearish": Strong downtrend (ADX >= 22, RSI < 48, Price < EMAs, -DI > +DI).
   - "ranging_choppy": Sideways oscillation (ADX < 20, flat EMAs, RSI oscillating between 40-60).
   - "high_volatility_breakout": Expanding ATR/volatility, volume surge > 1.3x, breaking out of contraction.
   - "low_volatility_consolidation": Contracting volatility, low ATR, Bollinger squeeze (isBbSqueeze=true).
2. selectedStrategyId MUST be one of: ${catalog.map(s => `"${s.id}"`).join(', ')}.
3. EMPIRICAL BACKTEST INTEGRATION:
   You are provided with empirical backtest results executed on the recent historical bars for this exact asset.
   Cross-reference the market condition with the backtest results. Heavily favor strategies that have demonstrated positive win rates (>=50%) and profit factors (>=1.2) under these exact market dynamics.
4. recommendedTimeframe: "1m", "3m", "5m", "15m", "30m", or "1h".
5. recommendedTp: Dynamic Take Profit % calibrated to current ATR (typically 1.5% to 4.0%).
6. recommendedSl: Dynamic Stop Loss % ensuring (recommendedTp / recommendedSl) >= ${Math.max(1.0, bot.MIN_RR || 1.5)}.
7. standAside: boolean (true if market is erratic, unreadable, or extreme chop where all strategies are losing).
8. reasoning: 2-3 concise quantitative sentences explaining the regime diagnosis (mentioning ADX, RSI, EMAs, Squeeze) and why the chosen strategy has statistical edge and backtest validation.

Respond strictly with valid JSON without markdown fences:
{
  "marketCondition": "trending_bullish",
  "confidence": "high",
  "selectedStrategyId": "mtf_bullish_trend_pullback",
  "strategyName": "MTF Bullish Trend & EMA Pullback",
  "reasoning": "...",
  "recommendedTimeframe": "5m",
  "recommendedTp": 2.2,
  "recommendedSl": 1.0,
  "standAside": false
}`;

            const userPrompt = `Symbol: ${symbol} (${bot.EXCHANGE.toUpperCase()})
Trading Mode: ${bot.MODE.toUpperCase()} | Required Min RR: ${bot.MIN_RR || 1.5} | Min Score: ${bot.MIN_SCORE || 50}
Current Price: $${snapshot.currentPrice} | Approx 24h Change: ${snapshot.change24h}%
Intraday Base TF (${baseTf}):
- RSI (14): ${snapshot.rsi}
- EMA Trend Bias: ${snapshot.emaTrend}
- ADX (14): ${snapshot.adx} (+DI: ${snapshot.diPlus}, -DI: ${snapshot.diMinus}) -> ${snapshot.trendStrength}
- ATR: ${snapshot.atr} (${snapshot.atrPercent}% of price) -> Volatility: ${snapshot.volatilityLevel}
- Bollinger BandWidth: ${snapshot.bbWidth} | In Volatility Squeeze: ${snapshot.isBbSqueeze}
- Volume Ratio (vs 20-period avg): ${snapshot.volumeRatio}x
Macro Higher TF (1h):
- 1h Trend: ${snapshot.htf1hTrend} | 1h RSI: ${snapshot.htf1hRsi}

Empirical In-Memory Backtest Leaderboard (Tested on recent ${candles.length} closed bars of ${symbol}):
${backtestLeaderboard}

Analyze the quantitative metrics and backtest leaderboard, deduce the market regime, and select the optimal strategy from the catalog now.`;

            const rawText = await generateWithGemini({
                prompt: userPrompt,

                systemInstruction: systemPrompt,
                temperature: 0.1,
            });

            const cleaned = rawText.replace(/```json\n?|\n?```/g, '').trim();
            const json = JSON.parse(cleaned);

            const validStrategyIds = catalog.map(s => s.id);
            const validConditions = [
                'trending_bullish',
                'trending_bearish',
                'ranging_choppy',
                'high_volatility_breakout',
                'low_volatility_consolidation',
            ];

            if (json.selectedStrategyId && validStrategyIds.includes(json.selectedStrategyId)) {
                const stratDef = getStrategyById(json.selectedStrategyId)!;
                aiResult = {
                    marketCondition: validConditions.includes(json.marketCondition) ? json.marketCondition : 'ranging_choppy',
                    confidence: ['high', 'medium', 'low'].includes(json.confidence) ? json.confidence : 'high',
                    selectedStrategyId: json.selectedStrategyId,
                    strategyName: String(json.strategyName || stratDef.name),
                    reasoning: String(json.reasoning || `Selected ${stratDef.name} via Gemini AI quantitative analysis.`),
                    recommendedTimeframe: json.recommendedTimeframe || stratDef.recommendedTimeframe,
                    recommendedTp: Math.max(0.4, Math.min(Number(json.recommendedTp) || stratDef.defaultTpPercent, 10.0)),
                    recommendedSl: Math.max(0.2, Math.min(Number(json.recommendedSl) || stratDef.defaultSlPercent, 5.0)),
                    standAside: Boolean(json.standAside),
                };
            }
        } catch (err: any) {
            console.warn(`[AI MarketEvaluator][${botId}] Direct Gemini evaluation failed (${err?.message}). Falling back to quant rules.`);
        }
    } else {
        console.warn(`[AI MarketEvaluator][${botId}] GEMINI_API_KEY is not set. Using local quantitative rule engine.`);
    }

    // Local Quant Rule Fallback (if Gemini offline or key missing)
    if (!aiResult) {
        let fallbackId = 'mtf_bollinger_mean_reversion';
        let fallbackCond: AiMarketEvaluationResponse['marketCondition'] = 'ranging_choppy';

        const isBullish = snapshot.trendStrength === 'strong_trend' && (snapshot.emaTrend === 'bullish' || snapshot.htf1hTrend === 'bullish') && snapshot.rsi > 50;
        const isBearish = snapshot.trendStrength === 'strong_trend' && (snapshot.emaTrend === 'bearish' || snapshot.htf1hTrend === 'bearish') && snapshot.rsi < 50;

        if (snapshot.isBbSqueeze || snapshot.volatilityLevel === 'high') {
            fallbackId = snapshot.volatilityLevel === 'high' ? 'mtf_donchian_breakout_scalper' : 'mtf_volatility_squeeze_breakout';
            fallbackCond = snapshot.volatilityLevel === 'high' ? 'high_volatility_breakout' : 'low_volatility_consolidation';
        } else if (isBullish) {
            fallbackId = 'mtf_supertrend_vwap_trend';
            fallbackCond = 'trending_bullish';
        } else if (isBearish) {
            fallbackId = 'mtf_bearish_breakdown';
            fallbackCond = 'trending_bearish';
        } else if (snapshot.adx < 20) {
            fallbackId = 'mtf_macd_stoch_reversal';
            fallbackCond = 'ranging_choppy';
        }

        // If top backtest strategy is profitable and matches regime direction, promote it
        const topBacktest = backtestResults[0];
        if (topBacktest && topBacktest.status === 'profitable' && topBacktest.winRate >= 50) {
            const topDef = getStrategyById(topBacktest.strategyId);
            if (topDef && topDef.bestMarketConditions.includes(fallbackCond)) {
                fallbackId = topDef.id;
            }
        }

        const stratDef = getStrategyById(fallbackId) || STRATEGY_LIBRARY.mtf_bullish_trend_pullback;
        aiResult = {
            marketCondition: fallbackCond,
            confidence: 'medium',
            selectedStrategyId: stratDef.id,
            strategyName: stratDef.name,
            reasoning: `Empirical quant fallback selection: ${stratDef.name} (ADX=${snapshot.adx} [${snapshot.trendStrength}], RSI=${snapshot.rsi}, ATR=${snapshot.atrPercent}%, 1hTrend=${snapshot.htf1hTrend}).`,
            recommendedTimeframe: stratDef.recommendedTimeframe,
            recommendedTp: stratDef.defaultTpPercent,
            recommendedSl: stratDef.defaultSlPercent,
            standAside: false,
        };
    }


    // Apply selected strategy
    const selectedStrat = getStrategyById(aiResult.selectedStrategyId) || STRATEGY_LIBRARY.mtf_bullish_trend_pullback;

    const now = new Date();
    const nextEval = new Date(now.getTime() + SIX_HOURS_MS);

    // Apply to in-memory bot runtime configuration
    bot.PINE_SCRIPT = selectedStrat.pineScript;
    bot.TIMEFRAME = aiResult.recommendedTimeframe || selectedStrat.recommendedTimeframe;
    bot.TP_PERCENT = aiResult.recommendedTp || selectedStrat.defaultTpPercent;
    bot.SL_PERCENT = aiResult.recommendedSl || selectedStrat.defaultSlPercent;
    bot.CURRENT_STRATEGY_ID = selectedStrat.id;
    bot.CURRENT_STRATEGY_NAME = selectedStrat.name;
    bot.MARKET_CONDITION = aiResult.marketCondition;
    bot.AI_REASONING = aiResult.reasoning;
    bot.LAST_AI_EVALUATION = now.toISOString();
    bot.NEXT_AI_EVALUATION = nextEval.toISOString();

    // Cache evaluation details
    evaluationCache.set(botId, {
        lastEvaluationTs: now.getTime(),
        strategyId: selectedStrat.id,
        baselineAtr: snapshot.atr,
        baselineEmaTrend: snapshot.emaTrend,
    });

    console.log(`[AI MarketEvaluator][${botId}] ✓ AI Selected Strategy: "${selectedStrat.name}" [${selectedStrat.id}] | Regime: ${aiResult.marketCondition} | Next Eval: ${nextEval.toISOString()}`);
    console.log(`[AI MarketEvaluator][${botId}] Reasoning: ${aiResult.reasoning}`);

    // Asynchronously sync strategy assignment back to Payload CMS for web and mobile dashboard
    syncAiEvaluationToPayload(botId, {
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
        console.warn(`[AI MarketEvaluator][${botId}] Payload CMS sync warning:`, err?.message ?? err);
    });
}

/** Sync AI strategy selection to Payload CMS for admin/mobile display */
async function syncAiEvaluationToPayload(botId: string, data: any): Promise<void> {
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
