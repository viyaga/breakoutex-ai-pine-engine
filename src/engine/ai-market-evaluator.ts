import env from '../config/env';
import { PineBotConfig, Candle } from '../config/types';
import { getStrategyById, getStrategyCatalogForAi, STRATEGY_LIBRARY, getStrategiesForMarketCondition, PineStrategyDefinition } from '../pine/strategy-library';
import * as ind from '../pine/indicators';

import { generateWithGemini } from '../ai/gemini-client';
import { backtestAllStrategies, BacktestResult } from '../pine/backtester';
import { normalizeTimeframe } from '../pine/interpreter';
import { BotCycleLogger } from '../utils/cycle-logger';

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

/** Comprehensive Quantitative Snapshot calculation across 5m, 15m, 1h, and 4h */
export function computeMarketSnapshot(
    candles: Candle[],
    tf15mCandles?: Candle[],
    tf1hCandles?: Candle[],
    tf4hCandles?: Candle[]
) {
    if (!candles || candles.length < 20) {
        return {
            currentPrice: candles?.[candles.length - 1]?.close ?? 0,
            change24h: 0,
            rsi: 50,
            emaTrend: 'neutral' as const,
            atr: 0,
            atrPercent: 0,
            adx: 20,
            diPlus: 0,
            diMinus: 0,
            trendStrength: 'ranging_chop' as const,
            bbWidth: 0.02,
            isBbSqueeze: false,
            volumeRatio: 1.0,
            volatilityLevel: 'medium' as const,
            htf15mTrend: 'neutral' as const,
            htf15mRsi: 50,
            htf1hTrend: 'neutral' as const,
            htf1hRsi: 50,
            htf4hTrend: 'neutral' as const,
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

    // 8. 15M Setup Context
    let htf15mTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let htf15mRsi = 50;
    if (tf15mCandles && tf15mCandles.length >= 20) {
        const m15N = tf15mCandles.length;
        const m15Closes = tf15mCandles.map(c => c.close);
        const m15Ema20 = ind.ema(m15Closes, Math.min(20, m15N));
        const m15Ema50 = ind.ema(m15Closes, Math.min(50, m15N));
        const lastM15Ema20 = m15Ema20[m15N - 1] || m15Closes[m15N - 1];
        const lastM15Ema50 = m15Ema50[m15N - 1] || m15Closes[m15N - 1];

        htf15mTrend = lastM15Ema20 > lastM15Ema50 * 1.001 ? 'bullish' : lastM15Ema20 < lastM15Ema50 * 0.999 ? 'bearish' : 'neutral';
        const m15RsiSeries = ind.rsi(m15Closes, 14);
        htf15mRsi = Number((m15RsiSeries[m15N - 1] || 50).toFixed(1));
    }

    // 9. 1H Trend Context
    let htf1hTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let htf1hRsi = 50;
    if (tf1hCandles && tf1hCandles.length >= 20) {
        const htfN = tf1hCandles.length;
        const htfCloses = tf1hCandles.map(c => c.close);
        const htfEma50 = ind.ema(htfCloses, Math.min(50, htfN));
        const lastHtfClose = htfCloses[htfN - 1];
        const lastHtfEma50 = htfEma50[htfN - 1] || lastHtfClose;

        htf1hTrend = lastHtfClose > lastHtfEma50 * 1.002 ? 'bullish' : lastHtfClose < lastHtfEma50 * 0.998 ? 'bearish' : 'neutral';
        const htfRsiSeries = ind.rsi(htfCloses, 14);
        htf1hRsi = Number((htfRsiSeries[htfN - 1] || 50).toFixed(1));
    }

    // 10. 4H Macro Context
    let htf4hTrend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (tf4hCandles && tf4hCandles.length >= 20) {
        const h4N = tf4hCandles.length;
        const h4Closes = tf4hCandles.map(c => c.close);
        const h4Ema50 = ind.ema(h4Closes, Math.min(50, h4N));
        const h4Ema200 = ind.ema(h4Closes, Math.min(200, h4N));
        const lastH4Ema50 = h4Ema50[h4N - 1] || h4Closes[h4N - 1];
        const lastH4Ema200 = h4Ema200[h4N - 1] || h4Closes[h4N - 1];

        htf4hTrend = lastH4Ema50 > lastH4Ema200 * 1.002 ? 'bullish' : lastH4Ema50 < lastH4Ema200 * 0.998 ? 'bearish' : 'neutral';
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
        htf15mTrend,
        htf15mRsi,
        htf1hTrend,
        htf1hRsi,
        htf4hTrend,
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

    // 1. If not yet evaluated in this engine session, trigger evaluation
    if (!botCached) {
        return true;
    }

    // 2. Time-based check (6 hours max bot window)
    if (now - botCached.lastEvaluationTs >= SIX_HOURS_MS) {
        return true;
    }

    // 3. Event-Driven Regime Shock Invalidation:
    if (currentSnapshot) {
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
    tf15mCandles?: Candle[],
    tf1hCandles?: Candle[],
    tf4hCandles?: Candle[],
    logger?: BotCycleLogger
): Promise<void> {
    const botId = bot.id;
    const symbol = bot.SYMBOL;
    const baseTf = bot.TIMEFRAME || '5m';

    const snapshot = computeMarketSnapshot(candles, tf15mCandles, tf1hCandles, tf4hCandles);
    const cacheKey = getRegimeCacheKey(symbol, baseTf, bot.MODE);
    const cachedGlobal = globalRegimeCache.get(cacheKey);

    let aiResult: AiMarketEvaluationResponse | null = null;
    let backtestResults: BacktestResult[] = [];

    // 1. Check Global Smart Cache (Zero token consumption if valid)
    if (cachedGlobal) {
        const cacheCheck = isRegimeCacheValid(cachedGlobal, snapshot);
        if (cacheCheck.valid) {
            const ageMins = Math.round((Date.now() - cachedGlobal.evaluatedAt) / 60_000);
            const msg = `[AI Cache] ⚡ Cache HIT for ${cacheKey} (Age: ${ageMins}m) — Reusing active regime, 0 LLM tokens consumed.`;
            if (logger) logger.addLog(msg);
            console.log(msg);
            aiResult = cachedGlobal.response;
        } else {
            const msg = `[AI Cache] 🔄 Cache INVALIDATED for ${cacheKey} (${cacheCheck.reason}) — Re-analyzing market.`;
            if (logger) logger.addLog(msg);
            console.log(msg);
        }
    }

    // 2. If Cache Miss or Invalidated, run Backtest & Query Gemini AI
    if (!aiResult) {
        const startMsg = `[AI MarketEvaluator][${botId}] ── Triggering Direct Gemini AI Market Analysis & Backtest for ${symbol} ──`;
        if (logger) logger.addLog(startMsg);
        console.log(startMsg);

        // 1. Quantitative Pre-Classification (Regime Detector)
        let detectedRegime: AiMarketEvaluationResponse['marketCondition'] = 'ranging_choppy';

        const isBullish = snapshot.trendStrength === 'strong_trend' && (snapshot.emaTrend === 'bullish' || snapshot.htf1hTrend === 'bullish') && snapshot.rsi > 50;
        const isBearish = snapshot.trendStrength === 'strong_trend' && (snapshot.emaTrend === 'bearish' || snapshot.htf1hTrend === 'bearish') && snapshot.rsi < 50;

        if (snapshot.isBbSqueeze || snapshot.volatilityLevel === 'low') {
            detectedRegime = 'low_volatility_consolidation';
        } else if (snapshot.volatilityLevel === 'high' || snapshot.volumeRatio > 1.3) {
            detectedRegime = 'high_volatility_breakout';
        } else if (isBullish) {
            detectedRegime = 'trending_bullish';
        } else if (isBearish) {
            detectedRegime = 'trending_bearish';
        }

        // 2. Regime Gating: Filter eligible strategy families matching regime
        let eligibleStrategies = getStrategiesForMarketCondition(detectedRegime);
        if (!eligibleStrategies.length) {
            eligibleStrategies = Object.values(STRATEGY_LIBRARY);
        }

        // 3. Run live in-memory backtest simulation on eligible candidate strategies with full MTF candle map
        const candleMap = new Map<string, Candle[]>();
        candleMap.set(normalizeTimeframe(baseTf), candles);
        if (tf15mCandles && tf15mCandles.length) {
            candleMap.set('15m', tf15mCandles);
            candleMap.set('15', tf15mCandles);
        }
        if (tf1hCandles && tf1hCandles.length) {
            candleMap.set('1h', tf1hCandles);
            candleMap.set('60', tf1hCandles);
        }
        if (tf4hCandles && tf4hCandles.length) {
            candleMap.set('4h', tf4hCandles);
            candleMap.set('240', tf4hCandles);
        }

        backtestResults = backtestAllStrategies(eligibleStrategies, candleMap, baseTf);
        const compactBt = backtestResults.slice(0, 4).map((r, i) =>
            `${i + 1}.${r.strategyId}:WR=${r.winRate}%,PF=${r.profitFactor},PnL=${r.netPnlPercent > 0 ? '+' : ''}${r.netPnlPercent}%`
        ).join(' | ');

        const btSummary = `[AI MarketEvaluator][${botId}] Detected Regime: "${detectedRegime}" | Gated Candidates: ${eligibleStrategies.length} | Top Strategy: "${backtestResults[0]?.strategyName}" (NetPnL: ${backtestResults[0]?.netPnlPercent}%, WR: ${backtestResults[0]?.winRate}%, PF: ${backtestResults[0]?.profitFactor})`;
        if (logger) logger.addLog(btSummary);
        console.log(btSummary);

        const btHeader = `[AI MarketEvaluator][${botId}] 📊 Live Backtest Simulation (${eligibleStrategies.length} candidates on ${symbol}):`;
        if (logger) logger.addLog(btHeader);
        console.log(btHeader);

        backtestResults.forEach((r, idx) => {
            const row = `  #${idx + 1} [${r.status.toUpperCase()}] ${r.strategyId.padEnd(28)} | WinRate: ${r.winRate.toFixed(1)}% | PF: ${r.profitFactor.toFixed(2)} | NetPnL: ${r.netPnlPercent > 0 ? '+' : ''}${r.netPnlPercent.toFixed(2)}% | Trades: ${r.totalTrades} (W:${r.wins}/L:${r.losses}) | Exp: ${r.expectancy}% | MaxDD: ${r.maxDrawdownPercent}%`;
            if (logger) logger.addLog(row);
            console.log(row);
        });

        // Direct Gemini API call with regime-gated candidates
        if (env.geminiApiKey) {
            const aiStartTime = Date.now();
            let systemPrompt = '';
            let userPrompt = '';
            let rawText = '';
            let aiErrorMsg: string | undefined;

            try {
                const catalogSnippet = eligibleStrategies.map((s: PineStrategyDefinition, idx: number) => `${idx + 1}:${s.id}(${s.name})`).join('\n');

                systemPrompt = `You are BreakoutEx Quant Regime & Strategy Deductor.
Detected Regime: ${detectedRegime}.
Task: Select the single best strategy ID from the Gated Catalog for user mode (${bot.MODE}).
Gated Catalog:
${catalogSnippet}

Rules:
1. regime MUST be one of: ["trending_bullish","trending_bearish","ranging_choppy","high_volatility_breakout","low_volatility_consolidation"].
2. strat MUST be a valid ID from the Gated Catalog. Prioritize strategies with positive backtest WR (>=50%) and PF (>=1.2).
3. tp/sl: Dynamic % calibrated to ATR ensuring (tp/sl) >= ${Math.max(1.0, bot.MIN_RR || 1.5)}.
4. conf: "H"|"M"|"L", stand: true if market is unreadable/whipsaw.
5. why: 1 concise sentence.

Output strict single-line JSON:
{"regime":"${detectedRegime}","strat":"${eligibleStrategies[0].id}","tf":"5m","tp":2.5,"sl":1.0,"conf":"H","stand":false,"why":"Selected based on backtest edge and regime fit"}`;

                userPrompt = `PAIR:${symbol}|MODE:${bot.MODE.toUpperCase()}|MIN_RR:${bot.MIN_RR || 1.5}|REGIME:${detectedRegime}
5M:P=$${snapshot.currentPrice}|24h=${snapshot.change24h}%|RSI=${snapshot.rsi}|EMA=${snapshot.emaTrend}|ADX=${snapshot.adx}(+DI:${snapshot.diPlus},-DI:${snapshot.diMinus})|ATR=${snapshot.atrPercent}%|BBW=${snapshot.bbWidth}(Sq:${snapshot.isBbSqueeze ? 1 : 0})|Vol=${snapshot.volumeRatio}x
15M:Trend=${snapshot.htf15mTrend}|RSI=${snapshot.htf15mRsi}
1H:Trend=${snapshot.htf1hTrend}|RSI=${snapshot.htf1hRsi}
4H:MacroTrend=${snapshot.htf4hTrend}
BT:${compactBt}`;

                const promptLogMsg = `[AI MarketEvaluator][${botId}] 🤖 Sending market context to Gemini AI (${env.geminiModel}):\n${userPrompt}`;
                if (logger) logger.addLog(promptLogMsg);
                console.log(promptLogMsg);

                rawText = await generateWithGemini({
                    prompt: userPrompt,
                    systemInstruction: systemPrompt,
                    temperature: 0.1,
                });

                const durationMs = Date.now() - aiStartTime;
                const responseLogMsg = `[AI MarketEvaluator][${botId}] 📥 Gemini AI Raw Response (${durationMs}ms):\n${rawText}`;
                if (logger) logger.addLog(responseLogMsg);
                console.log(responseLogMsg);

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
                    const rawRegime = json.regime || json.marketCondition || detectedRegime;
                    const rawConf = String(json.conf || json.confidence || 'H').toUpperCase();
                    const mappedConf = rawConf.startsWith('H') ? 'high' : rawConf.startsWith('M') ? 'medium' : 'low';

                    aiResult = {
                        marketCondition: validConditions.includes(rawRegime) ? rawRegime : detectedRegime,
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

                // Log full AI input, prompts, and response directly into the bot cycle logger
                if (logger) {
                    logger.logAiInteraction({
                        model: env.geminiModel,
                        systemPrompt,
                        userPrompt,
                        rawResponse: rawText,
                        parsedResponse: aiResult || json,
                        durationMs,
                    });
                }

            } catch (err: any) {
                aiErrorMsg = err?.message ?? String(err);
                console.warn(`[AI MarketEvaluator][${botId}] Direct Gemini evaluation failed (${aiErrorMsg}). Falling back to quant rules.`);

                if (logger) {
                    logger.logAiInteraction({
                        model: env.geminiModel,
                        systemPrompt,
                        userPrompt,
                        rawResponse: rawText || undefined,
                        error: aiErrorMsg,
                        durationMs: Date.now() - aiStartTime,
                    });
                }
            }
        } else {
            console.warn(`[AI MarketEvaluator][${botId}] GEMINI_API_KEY is not set. Using local quantitative rule engine.`);
        }
    }



    // Local Quant Rule Fallback (if Gemini offline or key missing)
    if (!aiResult) {
        let fallbackCond = 'ranging_choppy' as AiMarketEvaluationResponse['marketCondition'];
        const isBullish = snapshot.trendStrength === 'strong_trend' && (snapshot.emaTrend === 'bullish' || snapshot.htf1hTrend === 'bullish') && snapshot.rsi > 50;
        const isBearish = snapshot.trendStrength === 'strong_trend' && (snapshot.emaTrend === 'bearish' || snapshot.htf1hTrend === 'bearish') && snapshot.rsi < 50;

        if (snapshot.isBbSqueeze || snapshot.volatilityLevel === 'low') {
            fallbackCond = 'low_volatility_consolidation';
        } else if (snapshot.volatilityLevel === 'high' || snapshot.volumeRatio > 1.3) {
            fallbackCond = 'high_volatility_breakout';
        } else if (isBullish) {
            fallbackCond = 'trending_bullish';
        } else if (isBearish) {
            fallbackCond = 'trending_bearish';
        }

        // Promote top backtest performer from candidate pool
        let fallbackId = backtestResults[0]?.strategyId;
        if (!fallbackId) {
            const pool = getStrategiesForMarketCondition(fallbackCond);
            fallbackId = pool[0]?.id || 'mtf_trend_continuation';
        }

        const stratDef = getStrategyById(fallbackId) || STRATEGY_LIBRARY.mtf_trend_continuation;
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


    // Apply selected strategy or stand aside
    const selectedStrat = getStrategyById(aiResult.selectedStrategyId) || STRATEGY_LIBRARY.mtf_trend_continuation;

    const now = new Date();
    const nextEval = new Date(now.getTime() + SIX_HOURS_MS);

    if (aiResult.standAside) {
        const standMsg = `[AI MarketEvaluator][${botId}] ⏸️ AI advised to STAND ASIDE (market condition: ${aiResult.marketCondition}, reason: "${aiResult.reasoning}"). Skipping strategy assignment to pause new trades.`;
        if (logger) logger.addLog(standMsg);
        console.log(standMsg);

        // Clear pine script to prevent entering trades in choppy/unreadable market
        bot.PINE_SCRIPT = '';
        bot.CURRENT_STRATEGY_ID = 'stand_aside';
        bot.CURRENT_STRATEGY_NAME = 'Stand Aside (Market Unfavorable)';
        bot.MARKET_CONDITION = aiResult.marketCondition;
        bot.AI_REASONING = aiResult.reasoning;
        bot.LAST_AI_EVALUATION = now.toISOString();
        bot.NEXT_AI_EVALUATION = nextEval.toISOString();

        botEvaluationCache.set(botId, {
            lastEvaluationTs: now.getTime(),
            strategyId: 'stand_aside',
            baselineAtr: snapshot.atr,
            baselineEmaTrend: snapshot.emaTrend,
        });

        // Sync stand aside state to Payload CMS
        syncAiEvaluationToPayload(botId, {
            strategyId: 'stand_aside',
            strategyName: 'Stand Aside (Market Unfavorable)',
            marketCondition: aiResult.marketCondition,
            aiReasoning: aiResult.reasoning,
            lastAiEvaluation: now.toISOString(),
            nextAiEvaluation: nextEval.toISOString(),
            pineScript: '',
            timeframe: bot.TIMEFRAME,
            tpPercent: bot.TP_PERCENT,
            slPercent: bot.SL_PERCENT,
        }).catch(err => {
            console.warn(`[AI MarketEvaluator][${botId}] Payload CMS sync warning:`, err?.message ?? err);
        });

        return;
    }

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


    const selectMsg = `[AI MarketEvaluator][${botId}] ✓ AI Selected Strategy: "${selectedStrat.name}" [${selectedStrat.id}] | Regime: ${aiResult.marketCondition} | Next Eval: ${nextEval.toISOString()}`;
    const reasonMsg = `[AI MarketEvaluator][${botId}] Reasoning: ${aiResult.reasoning}`;
    if (logger) {
        logger.addLog(selectMsg);
        logger.addLog(reasonMsg);
    }
    console.log(selectMsg);
    console.log(reasonMsg);

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
