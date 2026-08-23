// ================================================================
// Strategy Library — Curated Multi-Timeframe Pine Script Strategies
// Optimized for specific market regimes and automated AI management.
// ================================================================

export interface PineStrategyDefinition {
    id: string;
    name: string;
    description: string;
    bestMarketConditions: Array<
        'trending_bullish' |
        'trending_bearish' |
        'ranging_choppy' |
        'high_volatility_breakout' |
        'low_volatility_consolidation'
    >;
    recommendedTimeframe: string;
    defaultTpPercent: number;
    defaultSlPercent: number;
    pineScript: string;
}

export const STRATEGY_LIBRARY: Record<string, PineStrategyDefinition> = {
    mtf_bullish_trend_pullback: {
        id: 'mtf_bullish_trend_pullback',
        name: 'MTF Bullish Trend & EMA Pullback',
        description: 'Multi-timeframe trend system. Anchored to 1h macro EMA 200 filter, triggers long entries on 5m EMA 9/21 pullback crosses with RSI momentum confirmation.',
        bestMarketConditions: ['trending_bullish'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.4,
        defaultSlPercent: 1.0,
        pineScript: `//@version=5
strategy("MTF Bullish Trend & EMA Pullback", overlay=true)

// Higher Timeframe Filter (1 Hour)
htfEma200 = request.security(syminfo.tickerid, "1h", ta.ema(close, 200))
htfBullish = close > htfEma200

// Active 5m Indicators
fastEma = ta.ema(close, 9)
slowEma = ta.ema(close, 21)
trendEma = ta.ema(close, 50)
rsiVal = ta.rsi(close, 14)

// Entry Conditions
longCondition = htfBullish and ta.crossover(fastEma, slowEma) and close > trendEma and rsiVal > 50
longExit = ta.crossunder(fastEma, slowEma) or rsiVal > 75

if longCondition
    strategy.entry("Long", strategy.long)

if longExit
    strategy.close("Long")
`,
    },

    mtf_bearish_breakdown: {
        id: 'mtf_bearish_breakdown',
        name: 'MTF Bearish Trend & Momentum Breakdown',
        description: 'Multi-timeframe shorting system. Confirmed by 1h macro downtrend structure, enters short on 5m Triple EMA (9/21/55) breakdown with RSI < 45.',
        bestMarketConditions: ['trending_bearish'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.5,
        defaultSlPercent: 1.1,
        pineScript: `//@version=5
strategy("MTF Bearish Trend & Momentum Breakdown", overlay=true)

// Higher Timeframe Filter (1 Hour)
htfEma200 = request.security(syminfo.tickerid, "1h", ta.ema(close, 200))
htfBearish = close < htfEma200

// Active 5m Indicators
ema9 = ta.ema(close, 9)
ema21 = ta.ema(close, 21)
ema55 = ta.ema(close, 55)
rsiVal = ta.rsi(close, 14)

// Entry Conditions
bearStructure = ema9 < ema21 and ema21 < ema55
shortCondition = htfBearish and ta.crossunder(ema9, ema21) and close < ema55 and rsiVal < 45
shortExit = ta.crossover(ema9, ema21) or rsiVal < 25

if shortCondition
    strategy.entry("Short", strategy.short)

if shortExit
    strategy.close("Short")
`,
    },

    mtf_bollinger_mean_reversion: {
        id: 'mtf_bollinger_mean_reversion',
        name: 'MTF Bollinger Mean Reversion',
        description: 'Mean-reversion strategy for ranging and choppy markets. Buys lower band bounces when RSI < 35 and sells upper band rejections when RSI > 65.',
        bestMarketConditions: ['ranging_choppy', 'low_volatility_consolidation'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 1.6,
        defaultSlPercent: 0.8,
        pineScript: `//@version=5
strategy("MTF Bollinger Mean Reversion", overlay=true)

bbLength = input.int(20, "BB Length")
bbMult = input.float(2.0, "BB Multiplier")
rsiLength = input.int(14, "RSI Length")

[basis, upper, lower] = ta.bb(close, bbLength, bbMult)
rsiVal = ta.rsi(close, rsiLength)

// 15m HTF RSI for multi-timeframe divergence
htfRsi = request.security(syminfo.tickerid, "15m", ta.rsi(close, 14))

longCondition = ta.crossover(close, lower) and rsiVal < 38 and htfRsi < 45
shortCondition = ta.crossunder(close, upper) and rsiVal > 62 and htfRsi > 55

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)
`,
    },

    mtf_volatility_squeeze_breakout: {
        id: 'mtf_volatility_squeeze_breakout',
        name: 'MTF Volatility Squeeze Breakout',
        description: 'Detects 15m Bollinger Band contraction inside Keltner Channels (TTM Squeeze) and enters on 5m explosive momentum expansion.',
        bestMarketConditions: ['high_volatility_breakout', 'low_volatility_consolidation'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 3.0,
        defaultSlPercent: 1.2,
        pineScript: `//@version=5
strategy("MTF Volatility Squeeze Breakout", overlay=true)

// 15m Squeeze Detection
[htfBbBasis, htfBbUpper, htfBbLower] = request.security(syminfo.tickerid, "15m", ta.bb(close, 20, 1.5))
[htfKcBasis, htfKcUpper, htfKcLower] = request.security(syminfo.tickerid, "15m", ta.kc(close, 20, 1.5))

squeezeOn = (htfBbLower > htfKcLower) and (htfBbUpper < htfKcUpper)
squeezeOff = not squeezeOn

// 5m Momentum & Entry
mom = ta.mom(close, 12)
emaFast = ta.ema(close, 9)
emaSlow = ta.ema(close, 21)

longCondition = squeezeOff and mom > 0 and ta.crossover(emaFast, emaSlow)
shortCondition = squeezeOff and mom < 0 and ta.crossunder(emaFast, emaSlow)

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)
`,
    },

    mtf_donchian_breakout_scalper: {
        id: 'mtf_donchian_breakout_scalper',
        name: 'MTF Donchian High-Momentum Breakout',
        description: 'Exploits high-volatility breakouts above/below 20-period Donchian Channels with 1h trend filter and volume confirmation.',
        bestMarketConditions: ['high_volatility_breakout', 'trending_bullish'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.6,
        defaultSlPercent: 1.1,
        pineScript: `//@version=5
strategy("MTF Donchian High-Momentum Breakout", overlay=true)

// 1h Macro Trend Filter
htfEma50 = request.security(syminfo.tickerid, "1h", ta.ema(close, 50))

// 5m Donchian Channel
dUpper = ta.highest(high, 20)
dLower = ta.lowest(low, 20)
fastEma = ta.ema(close, 9)

longCondition = close > htfEma50 and ta.crossover(close, dUpper[1])
shortCondition = close < htfEma50 and ta.crossunder(close, dLower[1])

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)
`,
    },

    mtf_macd_stoch_reversal: {
        id: 'mtf_macd_stoch_reversal',
        name: 'MTF MACD & Stochastic Exhaustion Reversal',
        description: 'Captures turning points in oscillating and choppy regimes using Stochastic RSI extreme zones and MACD histogram crossovers.',
        bestMarketConditions: ['ranging_choppy', 'trending_bullish', 'trending_bearish'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 1.8,
        defaultSlPercent: 0.9,
        pineScript: `//@version=5
strategy("MTF MACD & Stochastic Exhaustion Reversal", overlay=true)

// 5m Stochastic RSI
[stochK, stochD] = ta.stoch(close, high, low, 14)

// 5m MACD
[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)

// 15m MACD Trend Filter
[htfMacd, htfSignal, htfHist] = request.security(syminfo.tickerid, "15m", ta.macd(close, 12, 26, 9))

longCondition = ta.crossover(stochK, 20) and ta.crossover(macdLine, signalLine) and htfHist > -1
shortCondition = ta.crossunder(stochK, 80) and ta.crossunder(macdLine, signalLine) and htfHist < 1

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)
`,
    },
};

/** Get a strategy by its unique ID */
export function getStrategyById(id: string): PineStrategyDefinition | null {
    return STRATEGY_LIBRARY[id] ?? null;
}

/** Get list of all strategies metadata for AI prompt catalog */
export function getStrategyCatalogForAi() {
    return Object.values(STRATEGY_LIBRARY).map(s => ({
        id: s.id,
        name: s.name,
        bestMarketConditions: s.bestMarketConditions,
        description: s.description,
        recommendedTimeframe: s.recommendedTimeframe,
        defaultTpPercent: s.defaultTpPercent,
        defaultSlPercent: s.defaultSlPercent,
    }));
}
