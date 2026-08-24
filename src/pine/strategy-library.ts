// ================================================================
// BreakoutEx AI — Production MTF Strategy Library (12 Strategy Families)
// ================================================================
//
// 12 strategy families covering all major market regimes:
//
// 01. MTF Trend Continuation
// 02. MTF Supertrend VWAP Trend
// 03. MTF Donchian Breakout
// 04. MTF ATR Range Expansion
// 05. MTF Volatility Squeeze
// 06. MTF Bollinger Mean Reversion
// 07. MTF Momentum Exhaustion Reversal
// 08. MTF Failed Breakout Reversal (Bull / Bear Traps)
// 09. MTF High Volatility Continuation
// 10. MTF Trend Pullback
// 11. MTF Range Breakout
// 12. MTF Extreme Volatility Reversal
//
// MTF architecture:
//
//     4H  → Macro regime
//      ↓
//     1H  → Trend / structure
//      ↓
//     15M → Setup / confirmation
//      ↓
//      5M → Entry trigger
//
// Pine Script: v6
// ================================================================

export interface PineStrategyDefinition {
    id: string;
    name: string;
    description: string;
    bestMarketConditions: Array<
        | 'trending_bullish'
        | 'trending_bearish'
        | 'ranging_choppy'
        | 'high_volatility_breakout'
        | 'low_volatility_consolidation'
    >;
    recommendedTimeframe: string;
    defaultTpPercent: number;
    defaultSlPercent: number;
    pineScript: string;
}

const PINE_HEADER = `//@version=6
`;

export const STRATEGY_LIBRARY: Record<string, PineStrategyDefinition> = {

    // ============================================================
    // 01. MTF TREND CONTINUATION
    // ============================================================

    mtf_trend_continuation: {
        id: 'mtf_trend_continuation',
        name: 'MTF EMA Trend Continuation',
        description:
            'Multi-timeframe trend continuation system using confirmed 4H and 1H EMA structure, 15M confirmation and 5M momentum entry. Designed for sustained bullish and bearish trends.',
        bestMarketConditions: [
            'trending_bullish',
            'trending_bearish',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.5,
        defaultSlPercent: 1.0,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF EMA Trend Continuation",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// INPUTS
// ================================================================

fastLen = input.int(9, "Fast EMA")
slowLen = input.int(21, "Slow EMA")
structureLen = input.int(50, "Structure EMA")

rsiLen = input.int(14, "RSI Length")
adxLen = input.int(14, "ADX Length")

tpPercent = input.float(2.5, "Take Profit %")
slPercent = input.float(1.0, "Stop Loss %")

// ================================================================
// 4H MACRO
// ================================================================

macroEma50 = request.security(
     syminfo.tickerid,
     "240",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

macroEma200 = request.security(
     syminfo.tickerid,
     "240",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

macroBullish = macroEma50 > macroEma200
macroBearish = macroEma50 < macroEma200

// ================================================================
// 1H TREND
// ================================================================

htfClose = request.security(
     syminfo.tickerid,
     "60",
     close[1],
     lookahead = barmerge.lookahead_on
)

htfEma50 = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

htfEma200 = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

bullTrend =
     macroBullish and
     htfClose > htfEma50 and
     htfEma50 > htfEma200

bearTrend =
     macroBearish and
     htfClose < htfEma50 and
     htfEma50 < htfEma200

// ================================================================
// 5M ENTRY
// ================================================================

emaFast = ta.ema(close, fastLen)
emaSlow = ta.ema(close, slowLen)
emaStructure = ta.ema(close, structureLen)

rsi = ta.rsi(close, rsiLen)

[diPlus, diMinus, adx] = ta.dmi(adxLen, adxLen)

longCondition =
     bullTrend and
     close > emaStructure and
     ta.crossover(emaFast, emaSlow) and
     rsi > 52 and
     rsi < 75 and
     adx > 20

shortCondition =
     bearTrend and
     close < emaStructure and
     ta.crossunder(emaFast, emaSlow) and
     rsi < 48 and
     rsi > 25 and
     adx > 20

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

// ================================================================
// RISK
// ================================================================

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * (1 - slPercent / 100),
         limit = strategy.position_avg_price * (1 + tpPercent / 100)
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * (1 + slPercent / 100),
         limit = strategy.position_avg_price * (1 - tpPercent / 100)
    )
`,
    },

    // ============================================================
    // 02. SUPERTREND + VWAP
    // ============================================================

    mtf_supertrend_vwap: {
        id: 'mtf_supertrend_vwap',
        name: 'MTF Supertrend VWAP Momentum',
        description:
            'Confirmed 1H Supertrend direction combined with 5M VWAP, EMA, RSI, ADX and volume confirmation for directional momentum trades.',
        bestMarketConditions: [
            'trending_bullish',
            'trending_bearish',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.5,
        defaultSlPercent: 1.0,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF Supertrend VWAP Momentum",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

stFactor = input.float(3.0, "Supertrend Factor")
stLength = input.int(10, "Supertrend ATR")

tpPercent = input.float(2.5, "Take Profit %")
slPercent = input.float(1.0, "Stop Loss %")

// ================================================================
// CONFIRMED 1H SUPERTREND
// ================================================================

supertrendDirection() =>
    [st, direction] = ta.supertrend(stFactor, stLength)
    direction[1]

htfDirection = request.security(
     syminfo.tickerid,
     "60",
     supertrendDirection(),
     lookahead = barmerge.lookahead_on
)

bullTrend = htfDirection < 0
bearTrend = htfDirection > 0

// ================================================================
// 5M
// ================================================================

ema9 = ta.ema(close, 9)
ema21 = ta.ema(close, 21)

vwap = ta.vwap(hlc3)

rsi = ta.rsi(close, 14)

[diPlus, diMinus, adx] = ta.dmi(14, 14)

volumeAverage = ta.sma(volume, 20)

volumeConfirmed =
     volume > volumeAverage * 1.10

longCondition =
     bullTrend and
     close > vwap and
     ema9 > ema21 and
     ta.crossover(ema9, ema21) and
     rsi > 52 and
     adx > 20 and
     volumeConfirmed

shortCondition =
     bearTrend and
     close < vwap and
     ema9 < ema21 and
     ta.crossunder(ema9, ema21) and
     rsi < 48 and
     adx > 20 and
     volumeConfirmed

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * (1 - slPercent / 100),
         limit = strategy.position_avg_price * (1 + tpPercent / 100)
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * (1 + slPercent / 100),
         limit = strategy.position_avg_price * (1 - tpPercent / 100)
    )
`,
    },

    // ============================================================
    // 03. DONCHIAN BREAKOUT
    // ============================================================

    mtf_donchian_breakout: {
        id: 'mtf_donchian_breakout',
        name: 'MTF Donchian Breakout',
        description:
            'High-quality directional breakout system using confirmed 4H and 1H trend alignment, 5M Donchian channel breakout, volume expansion and ADX confirmation.',
        bestMarketConditions: [
            'high_volatility_breakout',
            'trending_bullish',
            'trending_bearish',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.6,
        defaultSlPercent: 1.1,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF Donchian Breakout",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

donchianLength = input.int(20, "Donchian Length")
volumeMultiplier = input.float(1.20, "Volume Multiplier")

tpPercent = input.float(2.6, "Take Profit %")
slPercent = input.float(1.1, "Stop Loss %")

// ================================================================
// 4H
// ================================================================

ema50_4h = request.security(
     syminfo.tickerid,
     "240",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

ema200_4h = request.security(
     syminfo.tickerid,
     "240",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

bull4h = ema50_4h > ema200_4h
bear4h = ema50_4h < ema200_4h

// ================================================================
// 1H
// ================================================================

close1h = request.security(
     syminfo.tickerid,
     "60",
     close[1],
     lookahead = barmerge.lookahead_on
)

ema50_1h = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

ema200_1h = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

bull1h =
     close1h > ema50_1h and
     ema50_1h > ema200_1h

bear1h =
     close1h < ema50_1h and
     ema50_1h < ema200_1h

// ================================================================
// 5M BREAKOUT
// ================================================================

upper = ta.highest(high, donchianLength)[1]
lower = ta.lowest(low, donchianLength)[1]

volumeAverage = ta.sma(volume, 20)

volumeConfirmed =
     volume > volumeAverage * volumeMultiplier

[diPlus, diMinus, adx] = ta.dmi(14, 14)

longCondition =
     bull4h and
     bull1h and
     ta.crossover(close, upper) and
     volumeConfirmed and
     adx > 20

shortCondition =
     bear4h and
     bear1h and
     ta.crossunder(close, lower) and
     volumeConfirmed and
     adx > 20

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * (1 - slPercent / 100),
         limit = strategy.position_avg_price * (1 + tpPercent / 100)
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * (1 + slPercent / 100),
         limit = strategy.position_avg_price * (1 - tpPercent / 100)
    )
`,
    },

    // ============================================================
    // 04. ATR RANGE EXPANSION
    // ============================================================

    mtf_atr_range_expansion: {
        id: 'mtf_atr_range_expansion',
        name: 'MTF ATR Range Expansion Breakout',
        description:
            'Detects compressed 15M ranges and trades 5M range expansion only when 4H and 1H trend direction agree with ATR, ADX and volume expansion.',
        bestMarketConditions: [
            'low_volatility_consolidation',
            'high_volatility_breakout',
            'trending_bullish',
            'trending_bearish',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.8,
        defaultSlPercent: 1.1,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF ATR Range Expansion Breakout",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

rangeLength = input.int(20, "15M Range Length")

atrLength = input.int(14, "ATR Length")
atrAverageLength = input.int(50, "ATR Average")

volumeMultiplier = input.float(1.15, "Volume Multiplier")

tpPercent = input.float(2.8, "Take Profit %")
slPercent = input.float(1.1, "Stop Loss %")

// ================================================================
// 4H
// ================================================================

ema50_4h = request.security(
     syminfo.tickerid,
     "240",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

ema200_4h = request.security(
     syminfo.tickerid,
     "240",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

bull4h = ema50_4h > ema200_4h
bear4h = ema50_4h < ema200_4h

// ================================================================
// 1H
// ================================================================

close1h = request.security(
     syminfo.tickerid,
     "60",
     close[1],
     lookahead = barmerge.lookahead_on
)

ema50_1h = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

ema200_1h = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

bull1h =
     close1h > ema50_1h and
     ema50_1h > ema200_1h

bear1h =
     close1h < ema50_1h and
     ema50_1h < ema200_1h

// ================================================================
// 15M RANGE
// ================================================================

rangeHigh = request.security(
     syminfo.tickerid,
     "15",
     ta.highest(high, rangeLength)[1],
     lookahead = barmerge.lookahead_on
)

rangeLow = request.security(
     syminfo.tickerid,
     "15",
     ta.lowest(low, rangeLength)[1],
     lookahead = barmerge.lookahead_on
)

rangeSize = rangeHigh - rangeLow

atr15 = request.security(
     syminfo.tickerid,
     "15",
     ta.atr(14)[1],
     lookahead = barmerge.lookahead_on
)

compressed =
     rangeSize < atr15 * 8.0

// ================================================================
// 5M EXPANSION
// ================================================================

atr = ta.atr(atrLength)
atrAverage = ta.sma(atr, atrAverageLength)

atrExpanding =
     atr > atrAverage * 1.10

volumeAverage = ta.sma(volume, 20)

volumeExpanding =
     volume > volumeAverage * volumeMultiplier

[diPlus, diMinus, adx] = ta.dmi(14, 14)

longCondition =
     bull4h and
     bull1h and
     compressed and
     ta.crossover(close, rangeHigh) and
     atrExpanding and
     volumeExpanding and
     adx > 20

shortCondition =
     bear4h and
     bear1h and
     compressed and
     ta.crossunder(close, rangeLow) and
     atrExpanding and
     volumeExpanding and
     adx > 20

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * (1 - slPercent / 100),
         limit = strategy.position_avg_price * (1 + tpPercent / 100)
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * (1 + slPercent / 100),
         limit = strategy.position_avg_price * (1 - tpPercent / 100)
    )
`,
    },

    // ============================================================
    // 05. VOLATILITY SQUEEZE
    // ============================================================

    mtf_volatility_squeeze: {
        id: 'mtf_volatility_squeeze',
        name: 'MTF Volatility Squeeze Breakout',
        description:
            'Uses 15M Bollinger Band and Keltner Channel compression followed by an actual squeeze release, then confirms the 5M breakout with momentum and volume.',
        bestMarketConditions: [
            'low_volatility_consolidation',
            'high_volatility_breakout',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 3.0,
        defaultSlPercent: 1.2,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF Volatility Squeeze Breakout",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

bbLength = input.int(20, "BB Length")
bbMult = input.float(2.0, "BB Multiplier")

kcLength = input.int(20, "KC Length")
kcMult = input.float(1.5, "KC Multiplier")

tpPercent = input.float(3.0, "Take Profit %")
slPercent = input.float(1.2, "Stop Loss %")

// ================================================================
// 15M CONFIRMED BOLLINGER
// ================================================================

bbBasis = request.security(
     syminfo.tickerid,
     "15",
     ta.sma(close, bbLength)[1],
     lookahead = barmerge.lookahead_on
)

bbDev = request.security(
     syminfo.tickerid,
     "15",
     ta.stdev(close, bbLength)[1],
     lookahead = barmerge.lookahead_on
)

bbUpper = bbBasis + bbMult * bbDev
bbLower = bbBasis - bbMult * bbDev

// ================================================================
// 15M KELTNER
// ================================================================

kcBasis = request.security(
     syminfo.tickerid,
     "15",
     ta.ema(close, kcLength)[1],
     lookahead = barmerge.lookahead_on
)

kcAtr = request.security(
     syminfo.tickerid,
     "15",
     ta.atr(kcLength)[1],
     lookahead = barmerge.lookahead_on
)

kcUpper = kcBasis + kcMult * kcAtr
kcLower = kcBasis - kcMult * kcAtr

squeezeOn =
     bbLower > kcLower and
     bbUpper < kcUpper

// Actual release
squeezeRelease =
     squeezeOn[1] and
     not squeezeOn

// ================================================================
// 5M MOMENTUM
// ================================================================

ema9 = ta.ema(close, 9)
ema21 = ta.ema(close, 21)

momentum = ta.mom(close, 12)

rsi = ta.rsi(close, 14)

volumeAverage = ta.sma(volume, 20)

volumeExpansion =
     volume > volumeAverage * 1.20

recentHigh = ta.highest(high, 12)[1]
recentLow = ta.lowest(low, 12)[1]

longCondition =
     squeezeRelease and
     close > recentHigh and
     ema9 > ema21 and
     momentum > 0 and
     rsi > 52 and
     volumeExpansion

shortCondition =
     squeezeRelease and
     close < recentLow and
     ema9 < ema21 and
     momentum < 0 and
     rsi < 48 and
     volumeExpansion

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * (1 - slPercent / 100),
         limit = strategy.position_avg_price * (1 + tpPercent / 100)
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * (1 + slPercent / 100),
         limit = strategy.position_avg_price * (1 - tpPercent / 100)
    )
`,
    },

    // ============================================================
    // 06. BOLLINGER MEAN REVERSION
    // ============================================================

    mtf_bollinger_mean_reversion: {
        id: 'mtf_bollinger_mean_reversion',
        name: 'MTF Bollinger RSI Mean Reversion',
        description:
            'Range strategy using low-trend 1H conditions, 15M RSI context and 5M Bollinger Band re-entry with RSI extremes.',
        bestMarketConditions: [
            'ranging_choppy',
            'low_volatility_consolidation',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 1.6,
        defaultSlPercent: 0.8,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF Bollinger RSI Mean Reversion",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

bbLength = input.int(20, "BB Length")
bbMult = input.float(2.0, "BB Multiplier")

tpPercent = input.float(1.6, "Take Profit %")
slPercent = input.float(0.8, "Stop Loss %")

// ================================================================
// 1H RANGE REGIME
// ================================================================

ema50 = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

ema200 = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

[diPlusHTF, diMinusHTF, adxHTF] = request.security(
     syminfo.tickerid,
     "60",
     ta.dmi(14, 14),
     lookahead = barmerge.lookahead_on
)

trendDistance =
     math.abs(ema50 - ema200) / ema200

rangeRegime =
     adxHTF < 25 and
     trendDistance < 0.02

// ================================================================
// 15M RSI
// ================================================================

rsi15 = request.security(
     syminfo.tickerid,
     "15",
     ta.rsi(close, 14)[1],
     lookahead = barmerge.lookahead_on
)

// ================================================================
// 5M BB
// ================================================================

basis = ta.sma(close, bbLength)

dev = ta.stdev(close, bbLength) * bbMult

upper = basis + dev
lower = basis - dev

rsi = ta.rsi(close, 14)

longCondition =
     rangeRegime and
     low < lower and
     ta.crossover(close, lower) and
     rsi < 38 and
     rsi15 < 48

shortCondition =
     rangeRegime and
     high > upper and
     ta.crossunder(close, upper) and
     rsi > 62 and
     rsi15 > 52

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * (1 - slPercent / 100),
         limit = strategy.position_avg_price * (1 + tpPercent / 100)
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * (1 + slPercent / 100),
         limit = strategy.position_avg_price * (1 - tpPercent / 100)
    )
`,
    },

    // ============================================================
    // 07. MOMENTUM EXHAUSTION REVERSAL
    // ============================================================

    mtf_momentum_exhaustion: {
        id: 'mtf_momentum_exhaustion',
        name: 'MTF Momentum Exhaustion Reversal',
        description:
            'Reversal strategy for range-bound and exhausted markets using low-trend 1H regime, 15M MACD momentum change and 5M RSI/Stochastic reversal.',
        bestMarketConditions: [
            'ranging_choppy',
            'low_volatility_consolidation',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 1.8,
        defaultSlPercent: 0.9,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF Momentum Exhaustion Reversal",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// 1H RANGE
// ================================================================

ema50 = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

ema200 = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

[diPlus, diMinus, adx] = request.security(
     syminfo.tickerid,
     "60",
     ta.dmi(14, 14),
     lookahead = barmerge.lookahead_on
)

rangeRegime =
     adx < 25 and
     math.abs(ema50 - ema200) / ema200 < 0.02

// ================================================================
// 15M MACD
// ================================================================

[macd15, signal15, hist15] = request.security(
     syminfo.tickerid,
     "15",
     ta.macd(close, 12, 26, 9),
     lookahead = barmerge.lookahead_on
)

bullishMomentumImproving =
     hist15 > hist15[1]

bearishMomentumWeakening =
     hist15 < hist15[1]

// ================================================================
// 5M
// ================================================================

rsi = ta.rsi(close, 14)

stoch = ta.stoch(
     close,
     high,
     low,
     14
)

bullishReversal =
     ta.crossover(stoch, 20) and
     ta.crossover(rsi, 30)

bearishReversal =
     ta.crossunder(stoch, 80) and
     ta.crossunder(rsi, 70)

longCondition =
     rangeRegime and
     bullishMomentumImproving and
     bullishReversal

shortCondition =
     rangeRegime and
     bearishMomentumWeakening and
     bearishReversal

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * 0.991,
         limit = strategy.position_avg_price * 1.018
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * 1.009,
         limit = strategy.position_avg_price * 0.982
    )
`,
    },

    // ============================================================
    // 08. FAILED BREAKOUT REVERSAL (BULL / BEAR TRAPS)
    // ============================================================

    mtf_failed_breakout: {
        id: 'mtf_failed_breakout',
        name: 'MTF Failed Breakout Reversal',
        description:
            'Detects failed 15M range breakouts and uses 5M rejection back inside the range with momentum confirmation. Designed for bull traps and bear traps.',
        bestMarketConditions: [
            'ranging_choppy',
            'high_volatility_breakout',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 1.8,
        defaultSlPercent: 0.8,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF Failed Breakout Reversal",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// 15M RANGE
// ================================================================

rangeHigh = request.security(
     syminfo.tickerid,
     "15",
     ta.highest(high, 20)[1],
     lookahead = barmerge.lookahead_on
)

rangeLow = request.security(
     syminfo.tickerid,
     "15",
     ta.lowest(low, 20)[1],
     lookahead = barmerge.lookahead_on
)

// ================================================================
// 5M FAILED BREAKOUT
// ================================================================

rsi = ta.rsi(close, 14)

volumeAverage = ta.sma(volume, 20)

// Price trades above resistance
bullTrap =
     high > rangeHigh and
     close < rangeHigh and
     close < open

// Price trades below support
bearTrap =
     low < rangeLow and
     close > rangeLow and
     close > open

shortCondition =
     bullTrap and
     rsi < 60 and
     volume > volumeAverage

longCondition =
     bearTrap and
     rsi > 40 and
     volume > volumeAverage

if shortCondition
    strategy.entry("Short", strategy.short)

if longCondition
    strategy.entry("Long", strategy.long)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * 0.992,
         limit = strategy.position_avg_price * 1.018
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * 1.008,
         limit = strategy.position_avg_price * 0.982
    )
`,
    },

    // ============================================================
    // 09. HIGH VOLATILITY CONTINUATION
    // ============================================================

    mtf_high_volatility_continuation: {
        id: 'mtf_high_volatility_continuation',
        name: 'MTF High Volatility Trend Continuation',
        description:
            'Designed for strong high-volatility trends. Uses 1H trend direction with 5M ATR expansion, directional movement, EMA alignment and volume confirmation.',
        bestMarketConditions: [
            'trending_bullish',
            'trending_bearish',
            'high_volatility_breakout',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 3.0,
        defaultSlPercent: 1.2,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF High Volatility Trend Continuation",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// 1H TREND
// ================================================================

ema50 = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

ema200 = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

close1h = request.security(
     syminfo.tickerid,
     "60",
     close[1],
     lookahead = barmerge.lookahead_on
)

bullTrend =
     close1h > ema50 and
     ema50 > ema200

bearTrend =
     close1h < ema50 and
     ema50 < ema200

// ================================================================
// 5M VOLATILITY
// ================================================================

atr = ta.atr(14)
atrAverage = ta.sma(atr, 50)

volatilityExpansion =
     atr > atrAverage * 1.20

volumeAverage = ta.sma(volume, 20)

volumeExpansion =
     volume > volumeAverage * 1.20

[diPlus, diMinus, adx] = ta.dmi(14, 14)

ema9 = ta.ema(close, 9)
ema21 = ta.ema(close, 21)

longCondition =
     bullTrend and
     volatilityExpansion and
     volumeExpansion and
     adx > 25 and
     diPlus > diMinus and
     ema9 > ema21

shortCondition =
     bearTrend and
     volatilityExpansion and
     volumeExpansion and
     adx > 25 and
     diMinus > diPlus and
     ema9 < ema21

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * 0.988,
         limit = strategy.position_avg_price * 1.030
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * 1.012,
         limit = strategy.position_avg_price * 0.970
    )
`,
    },

    // ============================================================
    // 10. MTF TREND PULLBACK
    // ============================================================

    mtf_trend_pullback: {
        id: 'mtf_trend_pullback',
        name: 'MTF EMA Pullback Re-entry',
        description:
            'Uses confirmed 4H and 1H trend alignment, 15M structure confirmation and 5M pullback rejection from EMA21 for trend re-entry.',
        bestMarketConditions: [
            'trending_bullish',
            'trending_bearish',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.4,
        defaultSlPercent: 1.0,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF EMA Pullback Re-entry",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// 4H
// ================================================================

ema50_4h = request.security(
     syminfo.tickerid,
     "240",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

ema200_4h = request.security(
     syminfo.tickerid,
     "240",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

bull4h = ema50_4h > ema200_4h
bear4h = ema50_4h < ema200_4h

// ================================================================
// 1H
// ================================================================

ema50_1h = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

ema200_1h = request.security(
     syminfo.tickerid,
     "60",
     ta.ema(close, 200)[1],
     lookahead = barmerge.lookahead_on
)

bull1h = ema50_1h > ema200_1h
bear1h = ema50_1h < ema200_1h

// ================================================================
// 15M STRUCTURE
// ================================================================

ema20_15 = request.security(
     syminfo.tickerid,
     "15",
     ta.ema(close, 20)[1],
     lookahead = barmerge.lookahead_on
)

ema50_15 = request.security(
     syminfo.tickerid,
     "15",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

bull15 = ema20_15 > ema50_15
bear15 = ema20_15 < ema50_15

// ================================================================
// 5M PULLBACK
// ================================================================

ema21 = ta.ema(close, 21)

rsi = ta.rsi(close, 14)

bullishRejection =
     low <= ema21 and
     close > ema21 and
     close > open

bearishRejection =
     high >= ema21 and
     close < ema21 and
     close < open

longCondition =
     bull4h and
     bull1h and
     bull15 and
     bullishRejection and
     rsi > 50

shortCondition =
     bear4h and
     bear1h and
     bear15 and
     bearishRejection and
     rsi < 50

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * 0.990,
         limit = strategy.position_avg_price * 1.024
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * 1.010,
         limit = strategy.position_avg_price * 0.976
    )
`,
    },

    // ============================================================
    // 11. MTF RANGE BREAKOUT
    // ============================================================

    mtf_range_breakout: {
        id: 'mtf_range_breakout',
        name: 'MTF Consolidation Range Breakout',
        description:
            'Targets sideways consolidation followed by directional expansion. Uses 15M range boundaries and 5M breakout confirmation with volume and momentum.',
        bestMarketConditions: [
            'low_volatility_consolidation',
            'high_volatility_breakout',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.5,
        defaultSlPercent: 1.0,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF Consolidation Range Breakout",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// 15M RANGE
// ================================================================

rangeHigh = request.security(
     syminfo.tickerid,
     "15",
     ta.highest(high, 24)[1],
     lookahead = barmerge.lookahead_on
)

rangeLow = request.security(
     syminfo.tickerid,
     "15",
     ta.lowest(low, 24)[1],
     lookahead = barmerge.lookahead_on
)

rangeSize = rangeHigh - rangeLow

atr15 = request.security(
     syminfo.tickerid,
     "15",
     ta.atr(14)[1],
     lookahead = barmerge.lookahead_on
)

compressed =
     rangeSize < atr15 * 10

// ================================================================
// 5M
// ================================================================

volumeAverage = ta.sma(volume, 20)

volumeExpansion =
     volume > volumeAverage * 1.15

momentum = ta.mom(close, 10)

longCondition =
     compressed and
     ta.crossover(close, rangeHigh) and
     momentum > 0 and
     volumeExpansion

shortCondition =
     compressed and
     ta.crossunder(close, rangeLow) and
     momentum < 0 and
     volumeExpansion

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * 0.990,
         limit = strategy.position_avg_price * 1.025
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * 1.010,
         limit = strategy.position_avg_price * 0.975
    )
`,
    },

    // ============================================================
    // 12. EXTREME VOLATILITY REVERSAL
    // ============================================================

    mtf_extreme_volatility_reversal: {
        id: 'mtf_extreme_volatility_reversal',
        name: 'MTF Extreme Volatility Reversal',
        description:
            'Designed for extreme price extensions where ATR becomes unusually elevated and momentum reaches exhaustion. Uses 15M RSI/MACD context and 5M reversal confirmation.',
        bestMarketConditions: [
            'high_volatility_breakout',
            'ranging_choppy',
        ],
        recommendedTimeframe: '5m',
        defaultTpPercent: 2.0,
        defaultSlPercent: 1.2,
        pineScript: `${PINE_HEADER}
strategy(
     "MTF Extreme Volatility Reversal",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// 15M EXTREME CONDITION
// ================================================================

rsi15 = request.security(
     syminfo.tickerid,
     "15",
     ta.rsi(close, 14)[1],
     lookahead = barmerge.lookahead_on
)

atr15 = request.security(
     syminfo.tickerid,
     "15",
     ta.atr(14)[1],
     lookahead = barmerge.lookahead_on
)

atrAverage15 = request.security(
     syminfo.tickerid,
     "15",
     ta.sma(ta.atr(14), 50)[1],
     lookahead = barmerge.lookahead_on
)

extremeVolatility =
     atr15 > atrAverage15 * 1.50

// ================================================================
// 5M
// ================================================================

rsi = ta.rsi(close, 14)

ema9 = ta.ema(close, 9)
ema21 = ta.ema(close, 21)

bearishReversal =
     extremeVolatility and
     rsi15 > 70 and
     rsi > 70 and
     ta.crossunder(ema9, ema21)

bullishReversal =
     extremeVolatility and
     rsi15 < 30 and
     rsi < 30 and
     ta.crossover(ema9, ema21)

if bullishReversal
    strategy.entry("Long", strategy.long)

if bearishReversal
    strategy.entry("Short", strategy.short)

if strategy.position_size > 0
    strategy.exit(
         "Long Exit",
         "Long",
         stop = strategy.position_avg_price * 0.988,
         limit = strategy.position_avg_price * 1.020
    )

if strategy.position_size < 0
    strategy.exit(
         "Short Exit",
         "Short",
         stop = strategy.position_avg_price * 1.012,
         limit = strategy.position_avg_price * 0.980
    )
`,
    },
};

// ================================================================
// STRATEGY LOOKUP
// ================================================================

export function getStrategyById(
    id: string
): PineStrategyDefinition | null {
    return STRATEGY_LIBRARY[id] ?? null;
}

// ================================================================
// ALL STRATEGIES
// ================================================================

export function getAllStrategies(): PineStrategyDefinition[] {
    return Object.values(STRATEGY_LIBRARY);
}

// ================================================================
// AI CATALOG
// ================================================================

export function getStrategyCatalogForAi() {
    return Object.values(STRATEGY_LIBRARY).map((strategy) => ({
        id: strategy.id,
        name: strategy.name,
        description: strategy.description,
        bestMarketConditions: strategy.bestMarketConditions,
        recommendedTimeframe: strategy.recommendedTimeframe,
        defaultTpPercent: strategy.defaultTpPercent,
        defaultSlPercent: strategy.defaultSlPercent,
    }));
}

// ================================================================
// STRATEGIES FOR MARKET CONDITION (REGIME GATING)
// ================================================================

export function getStrategiesForMarketCondition(
    condition:
        | 'trending_bullish'
        | 'trending_bearish'
        | 'ranging_choppy'
        | 'high_volatility_breakout'
        | 'low_volatility_consolidation'
): PineStrategyDefinition[] {
    return Object.values(STRATEGY_LIBRARY).filter((strategy) =>
        strategy.bestMarketConditions.includes(condition)
    );
}

// ================================================================
// STRATEGY IDS
// ================================================================

export const STRATEGY_IDS = Object.freeze(
    Object.keys(STRATEGY_LIBRARY)
);
