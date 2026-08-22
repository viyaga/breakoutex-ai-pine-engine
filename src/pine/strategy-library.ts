// ================================================================
// Strategy Library — Curated Pine Script Strategies for AI Management
// Each strategy is optimized for specific market regimes.
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
    supertrend_pullback: {
        id: 'supertrend_pullback',
        name: 'Supertrend Momentum Pullback',
        description: 'Trend-following strategy that uses Supertrend (10, 3) and EMA 21/50 alignment to catch pullback entries during strong bull/bear trends.',
        bestMarketConditions: ['trending_bullish', 'trending_bearish'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.2,
        defaultSlPercent: 1.0,
        pineScript: `//@version=5
strategy("Supertrend Momentum Pullback", overlay=true)

stPeriod = input.int(10, "Supertrend Period")
stMultiplier = input.float(3.0, "Supertrend Multiplier")
fastEmaLen = input.int(21, "Fast EMA")
slowEmaLen = input.int(50, "Slow EMA")

[stVal, stDir] = ta.supertrend(stMultiplier, stPeriod)
fastEma = ta.ema(close, fastEmaLen)
slowEma = ta.ema(close, slowEmaLen)

isBullTrend = stDir == 1 and fastEma > slowEma
isBearTrend = stDir == -1 and fastEma < slowEma

longCondition = isBullTrend and ta.crossover(close, fastEma)
shortCondition = isBearTrend and ta.crossunder(close, fastEma)

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)
`,
    },

    bollinger_mean_reversion: {
        id: 'bollinger_mean_reversion',
        name: 'Bollinger Bands Mean Reversion',
        description: 'Mean-reversion strategy designed for sideways, choppy, and consolidation markets using Bollinger Bands (20, 2) and RSI (14) oversold/overbought extremes.',
        bestMarketConditions: ['ranging_choppy', 'low_volatility_consolidation'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 1.5,
        defaultSlPercent: 0.8,
        pineScript: `//@version=5
strategy("Bollinger Mean Reversion", overlay=true)

bbLength = input.int(20, "BB Length")
bbMult = input.float(2.0, "BB Multiplier")
rsiLength = input.int(14, "RSI Length")

[basis, upper, lower] = ta.bb(close, bbLength, bbMult)
rsiVal = ta.rsi(close, rsiLength)

longCondition = ta.crossover(close, lower) and rsiVal < 40
shortCondition = ta.crossunder(close, upper) and rsiVal > 60

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)
`,
    },

    breakout_squeeze: {
        id: 'breakout_squeeze',
        name: 'Volatility Squeeze Breakout',
        description: 'Explosive breakout strategy that detects Bollinger Band contraction inside Keltner Channels (TTM Squeeze) and enters on momentum release.',
        bestMarketConditions: ['high_volatility_breakout', 'low_volatility_consolidation'],
        recommendedTimeframe: '15m',
        defaultTpPercent: 2.8,
        defaultSlPercent: 1.2,
        pineScript: `//@version=5
strategy("Volatility Squeeze Breakout", overlay=true)

bbLength = input.int(20, "BB Length")
bbMult = input.float(1.5, "BB Multiplier")
kcLength = input.int(20, "KC Length")
kcMult = input.float(1.5, "KC Multiplier")

[bbBasis, bbUpper, bbLower] = ta.bb(close, bbLength, bbMult)
[kcBasis, kcUpper, kcLower] = ta.kc(close, kcLength, kcMult)

squeezeOn = (bbLower > kcLower) and (bbUpper < kcUpper)
squeezeOff = not squeezeOn

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

    bearish_ema_breakdown: {
        id: 'bearish_ema_breakdown',
        name: 'Bearish Trend Breakdown',
        description: 'High-probability shorting strategy for sustained bear markets using triple EMA alignment (9/21/55) and RSI momentum breakdown.',
        bestMarketConditions: ['trending_bearish'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.4,
        defaultSlPercent: 1.1,
        pineScript: `//@version=5
strategy("Bearish Trend Breakdown", overlay=true)

ema9 = ta.ema(close, 9)
ema21 = ta.ema(close, 21)
ema55 = ta.ema(close, 55)
rsiVal = ta.rsi(close, 14)

isBearStructure = ema9 < ema21 and ema21 < ema55
shortTrigger = ta.crossunder(ema9, ema21) and close < ema55 and rsiVal < 45
longCover = ta.crossover(ema9, ema21) and close > ema55

if shortTrigger
    strategy.entry("Short", strategy.short)

if longCover
    strategy.entry("Long", strategy.long)
`,
    },

    mtf_ema_scalper: {
        id: 'mtf_ema_scalper',
        name: 'Multi-Timeframe Scalper',
        description: 'Fast 9/21 EMA dynamic crossover scalper with ATR trailing stop loss designed for rapid intraday momentum.',
        bestMarketConditions: ['trending_bullish', 'trending_bearish', 'ranging_choppy'],
        recommendedTimeframe: '5m',
        defaultTpPercent: 1.6,
        defaultSlPercent: 0.8,
        pineScript: `//@version=5
strategy("Multi-Timeframe Scalper", overlay=true)

fastEma = ta.ema(close, 9)
slowEma = ta.ema(close, 21)
filterEma = ta.ema(close, 100)

longSignal = ta.crossover(fastEma, slowEma) and close > filterEma
shortSignal = ta.crossunder(fastEma, slowEma) and close < filterEma

if longSignal
    strategy.entry("Long", strategy.long)

if shortSignal
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
