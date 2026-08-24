import env from '../config/env';
import { PineBotConfig, Candle } from '../config/types';
import { getStrategyById, getStrategyCatalogForAi, STRATEGY_LIBRARY } from '../pine/strategy-library';
import * as ind from '../pine/indicators';
import { generateWithGemini } from '../ai/gemini-client';
import { backtestAllStrategies, BacktestResult } from '../pine/backtester';
import { normalizeTimeframe } from '../pine/interpreter';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// Global Market Regime Cache across all bots & cycles
export interface GlobalMarketRegimeCache {
    evaluatedAt: number;
    expiresAt: number;
    response: AiMarketEvaluationResponse;
    baselinePrice: number;
    baselineAtr: number;
    baselineEmaTrend: 'bullish' | 'bearish' | 'neutral';
    baselineAdx: number;
    baselineTrendStrength: 'strong_trend' | 'moderate_trend' | 'ranging_chop';
}

const globalRegimeCache = new Map<string, GlobalMarketRegimeCache>();

// Per-bot evaluation cache
interface BotCacheEntry {
    lastEvaluationTs: number;
    strategyId: string;
    baselineAtr?: number;
    baselineEmaTrend?: 'bullish' | 'bearish' | 'neutral';
}
const botEvaluationCache = new Map<string, BotCacheEntry>();

function getRegimeCacheKey(symbol: string, timeframe: string, mode: string): string {
    return `${symbol.toUpperCase().trim()}:${timeframe.toLowerCase().trim()}:${mode.toLowerCase().trim()}`;
}

/** Check if cached AI regime is still mathematically and structurally valid */
export function isRegimeCacheValid(
    cached: GlobalMarketRegimeCache,
    currentSnapshot: ReturnType<typeof computeMarketSnapshot>
): { valid: boolean; reason?: string } {
    const now = Date.now();

    // 1. Time TTL check (2 hours)
    if (now >= cached.expiresAt) {
        return { valid: false, reason: 'Cache TTL expired' };
    }

    // 2. Volatility Shock Guard (ATR surge > 1.8x or collapse < 0.5x)
    if (cached.baselineAtr > 0 && currentSnapshot.atr > 0) {
        const atrRatio = currentSnapshot.atr / cached.baselineAtr;
        if (atrRatio > 1.8 || atrRatio < 0.5) {
            return { valid: false, reason: `Volatility shock (ATR ratio ${atrRatio.toFixed(2)}x)` };
        }
    }

    // 3. Trend Reversal Guard (EMA Direction flipped)
    if (
        cached.baselineEmaTrend !== 'neutral' &&
        currentSnapshot.emaTrend !== 'neutral' &&
        cached.baselineEmaTrend !== currentSnapshot.emaTrend
    ) {
        return { valid: false, reason: `Trend flipped from ${cached.baselineEmaTrend} to ${currentSnapshot.emaTrend}` };
    }

    // 4. Momentum Regime Transition (ADX shifted between trending and chop)
    if (
        (cached.baselineAdx < 20 && currentSnapshot.adx >= 25) ||
        (cached.baselineAdx >= 25 && currentSnapshot.adx < 18)
    ) {
        return { valid: false, reason: `ADX shifted from ${cached.baselineAdx} to ${currentSnapshot.adx}` };
    }

    // 5. Significant Price Displacement (> 4% move from cached baseline)
    if (cached.baselinePrice > 0 && currentSnapshot.currentPrice > 0) {
        const priceDiff = Math.abs(currentSnapshot.currentPrice - cached.baselinePrice) / cached.baselinePrice;
        if (priceDiff > 0.04) {
            return { valid: false, reason: `Price displaced by ${(priceDiff * 100).toFixed(1)}%` };
        }
    }

    return { valid: true };
}


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

/** Check if bot is due for an AI evaluation (scheduled interval or dynamic regime shock) */
export function isAiEvaluationDue(
    bot: PineBotConfig,
    currentSnapshot?: ReturnType<typeof computeMarketSnapshot>
): boolean {
    if (!bot.IS_AI_MANAGED) return false;

    const baseTf = bot.TIMEFRAME || '5m';
    const cacheKey = getRegimeCacheKey(bot.SYMBOL, baseTf, bot.MODE);
    const cachedGlobal = globalRegimeCache.get(cacheKey);

    // If a valid global regime cache exists and snapshot is steady, not due
    if (cachedGlobal && currentSnapshot && isRegimeCacheValid(cachedGlobal, currentSnapshot).valid) {
        return false;
    }

    const botCached = botEvaluationCache.get(bot.id);
    const now = Date.now();

    // 1. Time-based check (6 hours max bot window)
    let isTimeDue = true;
    if (botCached && now - botCached.lastEvaluationTs < SIX_HOURS_MS) {
        isTimeDue = false;
    } else if (bot.LAST_AI_EVALUATION) {
        const lastEvalTs = new Date(bot.LAST_AI_EVALUATION).getTime();
        if (!isNaN(lastEvalTs) && now - lastEvalTs < SIX_HOURS_MS) {
            isTimeDue = false;
        }
    }

    if (isTimeDue) return true;

    // 2. Event-Driven Regime Shock Invalidation:
    if (botCached && currentSnapshot) {
        if (botCached.baselineAtr && currentSnapshot.atr > botCached.baselineAtr * 2.0) {
            console.log(`[AI MarketEvaluator][${bot.id}] ⚡ Regime Shock Trigger: Volatility surged (ATR ${currentSnapshot.atr} vs base ${botCached.baselineAtr})`);
            return true;
        }
        if (botCached.baselineEmaTrend && botCached.baselineEmaTrend !== 'neutral' && currentSnapshot.emaTrend !== 'neutral' && botCached.baselineEmaTrend !== currentSnapshot.emaTrend) {
            console.log(`[AI MarketEvaluator][${bot.id}] ⚡ Regime Shift Trigger: EMA Trend flipped from ${botCached.baselineEmaTrend} to ${currentSnapshot.emaTrend}`);
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

    const snapshot = computeMarketSnapshot(candles, htfCandles);
    const cacheKey = getRegimeCacheKey(symbol, baseTf, bot.MODE);
    const cachedGlobal = globalRegimeCache.get(cacheKey);

    let aiResult: AiMarketEvaluationResponse | null = null;
    let backtestResults: BacktestResult[] = [];

    // 1. Check Global Smart Cache (Zero token consumption if valid)
    if (cachedGlobal) {
        const cacheCheck = isRegimeCacheValid(cachedGlobal, snapshot);
        if (cacheCheck.valid) {
            const ageMins = Math.round((Date.now() - cachedGlobal.evaluatedAt) / 60_000);
            console.log(`[AI Cache] ⚡ Cache HIT for ${cacheKey} (Age: ${ageMins}m) — Reusing active regime, 0 LLM tokens consumed.`);
            aiResult = cachedGlobal.response;
        } else {
            console.log(`[AI Cache] 🔄 Cache INVALIDATED for ${cacheKey} (${cacheCheck.reason}) — Re-analyzing market.`);
        }
    }

    // 2. If Cache Miss or Invalidated, run Backtest & Query Gemini AI
    if (!aiResult) {
        console.log(`[AI MarketEvaluator][${botId}] ── Triggering Direct Gemini AI Market Analysis & Backtest for ${symbol} ──`);

        const catalog = getStrategyCatalogForAi();

        // Run live in-memory backtest simulation on candidate strategies
        const candleMap = new Map<string, Candle[]>();
        candleMap.set(normalizeTimeframe(baseTf), candles);
        if (htfCandles && htfCandles.length) {
            candleMap.set('1h', htfCandles);
        }

        backtestResults = backtestAllStrategies(Object.values(STRATEGY_LIBRARY), candleMap, baseTf);
        // Compact backtest representation (top 3 strategies only to save tokens)
        const compactBt = backtestResults.slice(0, 3).map((r, i) =>
            `${i + 1}.${r.strategyId}:WR=${r.winRate}%,PF=${r.profitFactor},PnL=${r.netPnlPercent > 0 ? '+' : ''}${r.netPnlPercent}%`
        ).join(' | ');


        console.log(`[AI MarketEvaluator][${botId}] Live Backtest Top Performer: "${backtestResults[0]?.strategyName}" (NetPnL: ${backtestResults[0]?.netPnlPercent}%, WinRate: ${backtestResults[0]?.winRate}%)`);

        // Direct Gemini API call with ultra-compact token-optimized prompt & response schema
        if (env.geminiApiKey) {
            try {
                const systemPrompt = `You are BreakoutEx Quant Regime Deductor.
Input: Market metrics & historical backtest leaderboard.
Task: Deduce regime and pick best strategy ID from catalog matching user mode (${bot.MODE}).
Catalog:
1:mtf_supertrend_vwap_trend(trending_bullish/trending_bearish)
2:mtf_ema_pullback_continuation(trending_bullish/trending_bearish)
3:mtf_donchian_breakout(high_volatility_breakout/trending_bullish/trending_bearish)
4:mtf_volatility_squeeze_breakout(low_volatility_consolidation/high_volatility_breakout)
5:mtf_bollinger_mean_reversion(ranging_choppy/low_volatility_consolidation)
6:mtf_momentum_exhaustion_reversal(ranging_choppy/low_volatility_consolidation)
7:mtf_atr_range_breakout(low_volatility_consolidation/high_volatility_breakout)

Rules:
1. regime in ["trending_bullish","trending_bearish","ranging_choppy","high_volatility_breakout","low_volatility_consolidation"].
2. strat MUST be valid ID from catalog. Strongly favor strategies with positive backtest WR (>=50%) and PF (>=1.2).
3. tp/sl: Dynamic % calibrated to ATR ensuring (tp/sl) >= ${Math.max(1.0, bot.MIN_RR || 1.5)}.
4. conf: "H"|"M"|"L", stand: true if market is unreadable/whipsaw.
5. why: 1 concise sentence.

Output strict single-line JSON:
{"regime":"trending_bullish","strat":"mtf_supertrend_vwap_trend","tf":"5m","tp":2.5,"sl":1.0,"conf":"H","stand":false,"why":"Bullish ADX 26 with 71% WR backtest"}`;

                const userPrompt = `PAIR:${symbol}|MODE:${bot.MODE.toUpperCase()}|MIN_RR:${bot.MIN_RR || 1.5}
5M:P=$${snapshot.currentPrice}|24h=${snapshot.change24h}%|RSI=${snapshot.rsi}|EMA=${snapshot.emaTrend}|ADX=${snapshot.adx}(+DI:${snapshot.diPlus},-DI:${snapshot.diMinus})|ATR=${snapshot.atrPercent}%|BBW=${snapshot.bbWidth}(Sq:${snapshot.isBbSqueeze ? 1 : 0})|Vol=${snapshot.volumeRatio}x
1H:Trend=${snapshot.htf1hTrend}|RSI=${snapshot.htf1hRsi}
BT:${compactBt}`;

                const rawText = await generateWithGemini({
                    prompt: userPrompt,
                    systemInstruction: systemPrompt,
                    temperature: 0.1,
                });

                const cleaned = rawText.replace(/```json\n?|\n?```/g, '').trim();
                const json = JSON.parse(cleaned);

                const stratId = json.strat || json.selectedStrategyId;
                const validStrategyIds = Object.keys(STRATEGY_LIBRARY);
                const validConditions = [
                    'trending_bullish',
                    'trending_bearish',
                    'ranging_choppy',
                    'high_volatility_breakout',
                    'low_volatility_consolidation',
                ];

                if (stratId && validStrategyIds.includes(stratId)) {
                    const stratDef = getStrategyById(stratId)!;
                    const rawRegime = json.regime || json.marketCondition || 'ranging_choppy';
                    const rawConf = String(json.conf || json.confidence || 'H').toUpperCase();
                    const mappedConf = rawConf.startsWith('H') ? 'high' : rawConf.startsWith('M') ? 'medium' : 'low';

                    aiResult = {
                        marketCondition: validConditions.includes(rawRegime) ? rawRegime : 'ranging_choppy',
                        confidence: mappedConf as 'high' | 'medium' | 'low',
                        selectedStrategyId: stratId,
                        strategyName: stratDef.name,
                        reasoning: String(json.why || json.reasoning || `Selected ${stratDef.name} via quantitative deduction.`),
                        recommendedTimeframe: json.tf || json.recommendedTimeframe || stratDef.recommendedTimeframe,
                        recommendedTp: Math.max(0.4, Math.min(Number(json.tp || json.recommendedTp) || stratDef.defaultTpPercent, 10.0)),
                        recommendedSl: Math.max(0.2, Math.min(Number(json.sl || json.recommendedSl) || stratDef.defaultSlPercent, 5.0)),
                        standAside: Boolean(json.stand || json.standAside),
                    };

                    // Populate Global Cache for subsequent bots/cycles
                    globalRegimeCache.set(cacheKey, {
                        evaluatedAt: Date.now(),
                        expiresAt: Date.now() + TWO_HOURS_MS,
                        response: aiResult,
                        baselinePrice: snapshot.currentPrice,
                        baselineAtr: snapshot.atr,
                        baselineEmaTrend: snapshot.emaTrend,
                        baselineAdx: snapshot.adx,
                        baselineTrendStrength: snapshot.trendStrength,
                    });
                }
            } catch (err: any) {
                console.warn(`[AI MarketEvaluator][${botId}] Direct Gemini evaluation failed (${err?.message}). Falling back to quant rules.`);
            }
        } else {
            console.warn(`[AI MarketEvaluator][${botId}] GEMINI_API_KEY is not set. Using local quantitative rule engine.`);
        }
    }



    // Local Quant Rule Fallback (if Gemini offline or key missing)
    if (!aiResult) {
        let fallbackId = 'mtf_bollinger_mean_reversion';
        let fallbackCond: AiMarketEvaluationResponse['marketCondition'] = 'ranging_choppy';

        const isBullish = snapshot.trendStrength === 'strong_trend' && (snapshot.emaTrend === 'bullish' || snapshot.htf1hTrend === 'bullish') && snapshot.rsi > 50;
        const isBearish = snapshot.trendStrength === 'strong_trend' && (snapshot.emaTrend === 'bearish' || snapshot.htf1hTrend === 'bearish') && snapshot.rsi < 50;

        if (snapshot.isBbSqueeze || snapshot.volatilityLevel === 'high') {
            fallbackId = snapshot.volatilityLevel === 'high' ? 'mtf_donchian_breakout' : 'mtf_volatility_squeeze_breakout';
            fallbackCond = snapshot.volatilityLevel === 'high' ? 'high_volatility_breakout' : 'low_volatility_consolidation';
        } else if (isBullish) {
            fallbackId = 'mtf_supertrend_vwap_trend';
            fallbackCond = 'trending_bullish';
        } else if (isBearish) {
            fallbackId = 'mtf_ema_pullback_continuation';
            fallbackCond = 'trending_bearish';
        } else if (snapshot.adx < 20) {
            fallbackId = 'mtf_momentum_exhaustion_reversal';
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

        const stratDef = getStrategyById(fallbackId) || STRATEGY_LIBRARY.mtf_supertrend_vwap_trend;
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
    const selectedStrat = getStrategyById(aiResult.selectedStrategyId) || STRATEGY_LIBRARY.mtf_supertrend_vwap_trend;


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
    botEvaluationCache.set(botId, {
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
