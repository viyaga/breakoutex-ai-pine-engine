// ================================================================
// Strategy Library — Production MTF Quantitative Strategies
//
// Designed for:
//   - AI strategy selection
//   - TradingView backtesting
//   - Automated strategy evaluation
//   - Multi-timeframe trend / breakout / mean-reversion systems
//
// IMPORTANT:
// These are quantitative strategy templates.
// They are NOT guaranteed profitable or statistically proven.
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

export const STRATEGY_LIBRARY: Record<string, PineStrategyDefinition> = {

    // ============================================================
    // 1. MTF TREND CONTINUATION
    // ============================================================

    mtf_supertrend_vwap_trend: {
        id: 'mtf_supertrend_vwap_trend',
        name: 'MTF Supertrend VWAP Trend Continuation',

        description:
            'Confirmed 1H Supertrend trend filter combined with 15M EMA structure and 5M VWAP, EMA momentum, RSI and volume confirmation. Designed for established directional markets.',

        bestMarketConditions: [
            'trending_bullish',
            'trending_bearish',
        ],

        recommendedTimeframe: '5m',
        defaultTpPercent: 2.5,
        defaultSlPercent: 1.0,

        pineScript: `//@version=6
strategy(
     "MTF Supertrend VWAP Trend Continuation",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// INPUTS
// ================================================================

stFactor = input.float(3.0, "Supertrend Factor", step = 0.1)
stAtrLen = input.int(10, "Supertrend ATR Length")

fastLen = input.int(9, "Fast EMA")
slowLen = input.int(21, "Slow EMA")
structureLen = input.int(50, "Structure EMA")

rsiLen = input.int(14, "RSI Length")
adxLen = input.int(14, "ADX Length")

volumeLen = input.int(20, "Volume SMA Length")
volumeMultiplier = input.float(1.10, "Volume Multiplier", step = 0.05)

tpPercent = input.float(2.5, "Take Profit %", step = 0.1)
slPercent = input.float(1.0, "Stop Loss %", step = 0.1)

// ================================================================
// CONFIRMED HTF DATA
// ================================================================

confirmedSupertrendDirection() =>
    [st, direction] = ta.supertrend(stFactor, stAtrLen)
    direction[1]

htfDirection = request.security(
     syminfo.tickerid,
     "60",
     confirmedSupertrendDirection(),
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

// TradingView Supertrend convention:
// direction < 0 = bullish
// direction > 0 = bearish

htfBullish =
     htfDirection < 0 and
     htfEma50 > htfEma200

htfBearish =
     htfDirection > 0 and
     htfEma50 < htfEma200

// ================================================================
// 5M INDICATORS
// ================================================================

emaFast = ta.ema(close, fastLen)
emaSlow = ta.ema(close, slowLen)
emaStructure = ta.ema(close, structureLen)

vwapValue = ta.vwap(hlc3)

rsiValue = ta.rsi(close, rsiLen)

[diPlus, diMinus, adxValue] = ta.dmi(adxLen, adxLen)

volumeAverage = ta.sma(volume, volumeLen)

volumeConfirmed =
     volume > volumeAverage * volumeMultiplier

// ================================================================
// ENTRY
// ================================================================

longCondition =
     htfBullish and
     close > emaStructure and
     close > vwapValue and
     emaFast > emaSlow and
     ta.crossover(emaFast, emaSlow) and
     rsiValue > 52 and
     rsiValue < 75 and
     adxValue > 18 and
     volumeConfirmed

shortCondition =
     htfBearish and
     close < emaStructure and
     close < vwapValue and
     emaFast < emaSlow and
     ta.crossunder(emaFast, emaSlow) and
     rsiValue < 48 and
     rsiValue > 25 and
     adxValue > 18 and
     volumeConfirmed

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

// ================================================================
// RISK MANAGEMENT
// ================================================================

if strategy.position_size > 0
    longStop = strategy.position_avg_price * (1 - slPercent / 100)
    longTarget = strategy.position_avg_price * (1 + tpPercent / 100)

    strategy.exit(
         "Long Exit",
         "Long",
         stop = longStop,
         limit = longTarget
    )

if strategy.position_size < 0
    shortStop = strategy.position_avg_price * (1 + slPercent / 100)
    shortTarget = strategy.position_avg_price * (1 - tpPercent / 100)

    strategy.exit(
         "Short Exit",
         "Short",
         stop = shortStop,
         limit = shortTarget
    )

// ================================================================
// EARLY TREND EXIT
// ================================================================

if strategy.position_size > 0 and ta.crossunder(emaFast, emaSlow)
    strategy.close("Long", comment = "Trend Reversal")

if strategy.position_size < 0 and ta.crossover(emaFast, emaSlow)
    strategy.close("Short", comment = "Trend Reversal")
`,

    },

    // ============================================================
    // 2. MTF EMA PULLBACK
    // ============================================================

    mtf_ema_pullback_continuation: {
        id: 'mtf_ema_pullback_continuation',
        name: 'MTF EMA Pullback Continuation',

        description:
            '4H macro trend and confirmed 1H EMA structure identify the directional regime. The 15M trend confirms the setup while 5M price rejection from EMA21/EMA50 provides the entry trigger.',

        bestMarketConditions: [
            'trending_bullish',
            'trending_bearish',
        ],

        recommendedTimeframe: '5m',
        defaultTpPercent: 2.4,
        defaultSlPercent: 1.0,

        pineScript: `//@version=6
strategy(
     "MTF EMA Pullback Continuation",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// INPUTS
// ================================================================

emaFastLen = input.int(9, "Fast EMA")
emaPullbackLen = input.int(21, "Pullback EMA")
emaStructureLen = input.int(50, "Structure EMA")

rsiLen = input.int(14, "RSI Length")
adxLen = input.int(14, "ADX Length")

tpPercent = input.float(2.4, "Take Profit %", step = 0.1)
slPercent = input.float(1.0, "Stop Loss %", step = 0.1)

// ================================================================
// 4H MACRO TREND
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

htfBullish =
     htfEma50 > htfEma200

htfBearish =
     htfEma50 < htfEma200

// ================================================================
// 15M CONFIRMATION
// ================================================================

confirmationEma20 = request.security(
     syminfo.tickerid,
     "15",
     ta.ema(close, 20)[1],
     lookahead = barmerge.lookahead_on
)

confirmationEma50 = request.security(
     syminfo.tickerid,
     "15",
     ta.ema(close, 50)[1],
     lookahead = barmerge.lookahead_on
)

confirmationBullish =
     confirmationEma20 > confirmationEma50

confirmationBearish =
     confirmationEma20 < confirmationEma50

// ================================================================
// 5M ENTRY
// ================================================================

emaFast = ta.ema(close, emaFastLen)
emaPullback = ta.ema(close, emaPullbackLen)
emaStructure = ta.ema(close, emaStructureLen)

rsiValue = ta.rsi(close, rsiLen)

[diPlus, diMinus, adxValue] = ta.dmi(adxLen, adxLen)

// Pullback / rejection
bullishRejection =
     low <= emaPullback and
     close > emaPullback and
     close > open

bearishRejection =
     high >= emaPullback and
     close < emaPullback and
     close < open

longCondition =
     macroBullish and
     htfBullish and
     confirmationBullish and
     close > emaStructure and
     emaFast > emaPullback and
     bullishRejection and
     rsiValue > 50 and
     rsiValue < 72 and
     adxValue > 18

shortCondition =
     macroBearish and
     htfBearish and
     confirmationBearish and
     close < emaStructure and
     emaFast < emaPullback and
     bearishRejection and
     rsiValue < 50 and
     rsiValue > 28 and
     adxValue > 18

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

// ================================================================
// TP / SL
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
    // 3. MTF DONCHIAN BREAKOUT
    // ============================================================

    mtf_donchian_breakout: {
        id: 'mtf_donchian_breakout',
        name: 'MTF Donchian High Momentum Breakout',

        description:
            'Confirmed 4H and 1H trend filters combined with a 15M compression condition and 5M Donchian breakout. Requires volume and ATR expansion to reduce weak breakout entries.',

        bestMarketConditions: [
            'high_volatility_breakout',
            'trending_bullish',
            'trending_bearish',
            'low_volatility_consolidation',
        ],

        recommendedTimeframe: '5m',
        defaultTpPercent: 2.6,
        defaultSlPercent: 1.1,

        pineScript: `//@version=6
strategy(
     "MTF Donchian High Momentum Breakout",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// INPUTS
// ================================================================

donchianLength = input.int(20, "Donchian Length")
volumeLength = input.int(20, "Volume Average")
volumeMultiplier = input.float(1.20, "Breakout Volume Multiplier", step = 0.05)

atrLength = input.int(14, "ATR Length")
atrAverageLength = input.int(50, "ATR Average Length")

adxLength = input.int(14, "ADX Length")

tpPercent = input.float(2.6, "Take Profit %", step = 0.1)
slPercent = input.float(1.1, "Stop Loss %", step = 0.1)

// ================================================================
// 4H REGIME
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

htfBullish =
     htfClose > htfEma50 and
     htfEma50 > htfEma200

htfBearish =
     htfClose < htfEma50 and
     htfEma50 < htfEma200

// ================================================================
// 15M SETUP
// ================================================================

htf15Range = request.security(
     syminfo.tickerid,
     "15",
     ta.highest(high, 20)[1] - ta.lowest(low, 20)[1],
     lookahead = barmerge.lookahead_on
)

htf15Atr = request.security(
     syminfo.tickerid,
     "15",
     ta.atr(14)[1],
     lookahead = barmerge.lookahead_on
)

rangeCompressed =
     htf15Range < htf15Atr * 5.0

// ================================================================
// 5M BREAKOUT
// ================================================================

upperChannel = ta.highest(high, donchianLength)[1]
lowerChannel = ta.lowest(low, donchianLength)[1]

volumeAverage = ta.sma(volume, volumeLength)

volumeConfirmed =
     volume > volumeAverage * volumeMultiplier

atrValue = ta.atr(atrLength)
atrAverage = ta.sma(atrValue, atrAverageLength)

volatilityExpanding =
     atrValue > atrAverage

[diPlus, diMinus, adxValue] = ta.dmi(adxLength, adxLength)

longBreakout =
     ta.crossover(close, upperChannel)

shortBreakout =
     ta.crossunder(close, lowerChannel)

longCondition =
     macroBullish and
     htfBullish and
     longBreakout and
     volumeConfirmed and
     volatilityExpanding and
     adxValue > 20

shortCondition =
     macroBearish and
     htfBearish and
     shortBreakout and
     volumeConfirmed and
     volatilityExpanding and
     adxValue > 20

// Range compression is an additional positive signal,
// but not a mandatory requirement because strong trend
// continuation breakouts can occur without compression.

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

// ================================================================
// TP / SL
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
    // 4. MTF VOLATILITY SQUEEZE BREAKOUT
    // ============================================================

    mtf_volatility_squeeze_breakout: {
        id: 'mtf_volatility_squeeze_breakout',
        name: 'MTF Volatility Squeeze Expansion Breakout',

        description:
            'Detects confirmed 15M Bollinger/Keltner compression and waits for an actual squeeze release. The 5M entry requires momentum, EMA alignment and volume expansion.',

        bestMarketConditions: [
            'low_volatility_consolidation',
            'high_volatility_breakout',
        ],

        recommendedTimeframe: '5m',
        defaultTpPercent: 3.0,
        defaultSlPercent: 1.2,

        pineScript: `//@version=6
strategy(
     "MTF Volatility Squeeze Expansion Breakout",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// INPUTS
// ================================================================

bbLength = input.int(20, "BB Length")
bbMultiplier = input.float(2.0, "BB Multiplier")

kcLength = input.int(20, "KC Length")
kcMultiplier = input.float(1.5, "KC Multiplier")

emaFastLen = input.int(9, "Fast EMA")
emaSlowLen = input.int(21, "Slow EMA")

volumeLength = input.int(20, "Volume SMA")
volumeMultiplier = input.float(1.20, "Volume Expansion", step = 0.05)

rsiLength = input.int(14, "RSI Length")

tpPercent = input.float(3.0, "Take Profit %", step = 0.1)
slPercent = input.float(1.2, "Stop Loss %", step = 0.1)

// ================================================================
// 15M CONFIRMED SQUEEZE STATE
// ================================================================

bbUpper = request.security(
     syminfo.tickerid,
     "15",
     ta.sma(close, bbLength) +
         bbMultiplier * ta.stdev(close, bbLength),
     lookahead = barmerge.lookahead_on
)

bbLower = request.security(
     syminfo.tickerid,
     "15",
     ta.sma(close, bbLength) -
         bbMultiplier * ta.stdev(close, bbLength),
     lookahead = barmerge.lookahead_on
)

kcBasis = request.security(
     syminfo.tickerid,
     "15",
     ta.ema(close, kcLength),
     lookahead = barmerge.lookahead_on
)

kcAtr = request.security(
     syminfo.tickerid,
     "15",
     ta.atr(kcLength),
     lookahead = barmerge.lookahead_on
)

kcUpper = kcBasis + kcMultiplier * kcAtr
kcLower = kcBasis - kcMultiplier * kcAtr

squeezeOn =
     bbLower > kcLower and
     bbUpper < kcUpper

// ================================================================
// ACTUAL SQUEEZE RELEASE
// ================================================================

squeezeReleased =
     squeezeOn[1] and
     not squeezeOn

// ================================================================
// 5M MOMENTUM
// ================================================================

emaFast = ta.ema(close, emaFastLen)
emaSlow = ta.ema(close, emaSlowLen)

rsiValue = ta.rsi(close, rsiLength)

volumeAverage = ta.sma(volume, volumeLength)

volumeExpansion =
     volume > volumeAverage * volumeMultiplier

momentum = ta.mom(close, 12)

// ================================================================
// BREAKOUT CONFIRMATION
// ================================================================

recentHigh = ta.highest(high, 12)[1]
recentLow = ta.lowest(low, 12)[1]

longCondition =
     squeezeReleased and
     close > recentHigh and
     emaFast > emaSlow and
     momentum > 0 and
     rsiValue > 52 and
     rsiValue < 80 and
     volumeExpansion

shortCondition =
     squeezeReleased and
     close < recentLow and
     emaFast < emaSlow and
     momentum < 0 and
     rsiValue < 48 and
     rsiValue > 20 and
     volumeExpansion

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

// ================================================================
// TP / SL
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
    // 5. MTF BOLLINGER MEAN REVERSION
    // ============================================================

    mtf_bollinger_mean_reversion: {
        id: 'mtf_bollinger_mean_reversion',
        name: 'MTF Bollinger RSI Mean Reversion',

        description:
            'Designed for range-bound markets. Confirmed 1H low-trend regime and 15M RSI context combine with 5M Bollinger Band re-entry and RSI extremes. Avoids strong directional conditions.',

        bestMarketConditions: [
            'ranging_choppy',
            'low_volatility_consolidation',
        ],

        recommendedTimeframe: '5m',
        defaultTpPercent: 1.6,
        defaultSlPercent: 0.8,

        pineScript: `//@version=6
strategy(
     "MTF Bollinger RSI Mean Reversion",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// INPUTS
// ================================================================

bbLength = input.int(20, "BB Length")
bbMultiplier = input.float(2.0, "BB Multiplier")

rsiLength = input.int(14, "RSI Length")
adxLength = input.int(14, "ADX Length")

tpPercent = input.float(1.6, "Take Profit %", step = 0.1)
slPercent = input.float(0.8, "Stop Loss %", step = 0.1)

// ================================================================
// 1H REGIME FILTER
// ================================================================

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

htfAdx = request.security(
     syminfo.tickerid,
     "60",
     ta.adx(adxLength)[1],
     lookahead = barmerge.lookahead_on
)

htfTrendNeutral =
     math.abs(htfEma50 - htfEma200) / htfEma200 < 0.015 and
     htfAdx < 25

// ================================================================
// 15M RSI
// ================================================================

htfRsi = request.security(
     syminfo.tickerid,
     "15",
     ta.rsi(close, rsiLength)[1],
     lookahead = barmerge.lookahead_on
)

// ================================================================
// 5M BOLLINGER
// ================================================================

basis = ta.sma(close, bbLength)
deviation = bbMultiplier * ta.stdev(close, bbLength)

upper = basis + deviation
lower = basis - deviation

rsiValue = ta.rsi(close, rsiLength)

// ================================================================
// ADX
// ================================================================

[diPlus, diMinus, adxValue] = ta.dmi(adxLength, adxLength)

rangeEnvironment =
     adxValue < 25 and
     htfTrendNeutral

// ================================================================
// RE-ENTRY CONDITIONS
// ================================================================

longCondition =
     rangeEnvironment and
     low < lower and
     ta.crossover(close, lower) and
     rsiValue < 38 and
     htfRsi < 48

shortCondition =
     rangeEnvironment and
     high > upper and
     ta.crossunder(close, upper) and
     rsiValue > 62 and
     htfRsi > 52

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

// ================================================================
// TP / SL
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
    // 6. MTF RSI / MACD REVERSAL
    // ============================================================

    mtf_momentum_exhaustion_reversal: {
        id: 'mtf_momentum_exhaustion_reversal',
        name: 'MTF Momentum Exhaustion Reversal',

        description:
            'Range and exhaustion reversal strategy using confirmed 15M MACD momentum direction with 5M RSI/Stochastic extremes and reversal confirmation. Intended for non-trending or exhausted markets.',

        bestMarketConditions: [
            'ranging_choppy',
            'low_volatility_consolidation',
        ],

        recommendedTimeframe: '5m',
        defaultTpPercent: 1.8,
        defaultSlPercent: 0.9,

        pineScript: `//@version=6
strategy(
     "MTF Momentum Exhaustion Reversal",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// INPUTS
// ================================================================

rsiLength = input.int(14, "RSI Length")
stochLength = input.int(14, "Stochastic Length")

macdFast = input.int(12, "MACD Fast")
macdSlow = input.int(26, "MACD Slow")
macdSignal = input.int(9, "MACD Signal")

adxLength = input.int(14, "ADX Length")

tpPercent = input.float(1.8, "Take Profit %", step = 0.1)
slPercent = input.float(0.9, "Stop Loss %", step = 0.1)

// ================================================================
// 1H REGIME
// ================================================================

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

htfAdx = request.security(
     syminfo.tickerid,
     "60",
     ta.adx(adxLength)[1],
     lookahead = barmerge.lookahead_on
)

rangeRegime =
     htfAdx < 25 and
     math.abs(htfEma50 - htfEma200) / htfEma200 < 0.02

// ================================================================
// 15M MACD
// ================================================================

[htfMacd, htfSignal, htfHist] = request.security(
     syminfo.tickerid,
     "15",
     ta.macd(close, macdFast, macdSlow, macdSignal),
     lookahead = barmerge.lookahead_on
)

// Directional MACD improvement
htfBullishMomentum =
     htfHist > 0 or htfHist > htfHist[1]

htfBearishMomentum =
     htfHist < 0 or htfHist < htfHist[1]

// ================================================================
// 5M MOMENTUM
// ================================================================

rsiValue = ta.rsi(close, rsiLength)

stochValue = ta.stoch(
     close,
     high,
     low,
     stochLength
)

bullishReversal =
     ta.crossover(stochValue, 20) and
     ta.crossover(rsiValue, 30)

bearishReversal =
     ta.crossunder(stochValue, 80) and
     ta.crossunder(rsiValue, 70)

// ================================================================
// ENTRY
// ================================================================

longCondition =
     rangeRegime and
     htfBullishMomentum and
     bullishReversal

shortCondition =
     rangeRegime and
     htfBearishMomentum and
     bearishReversal

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

// ================================================================
// TP / SL
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
    // 7. MTF ATR RANGE BREAKOUT
    // ============================================================

    mtf_atr_range_breakout: {
        id: 'mtf_atr_range_breakout',
        name: 'MTF ATR Range Expansion Breakout',

        description:
            'Identifies a compressed 15M range and uses confirmed 1H trend direction plus 5M ATR expansion, range breakout and volume confirmation to enter emerging trends.',

        bestMarketConditions: [
            'low_volatility_consolidation',
            'high_volatility_breakout',
            'trending_bullish',
            'trending_bearish',
        ],

        recommendedTimeframe: '5m',
        defaultTpPercent: 2.8,
        defaultSlPercent: 1.1,

        pineScript: `//@version=6
strategy(
     "MTF ATR Range Expansion Breakout",
     overlay = true,
     pyramiding = 0,
     process_orders_on_close = true,
     commission_type = strategy.commission.percent,
     commission_value = 0.05
)

// ================================================================
// INPUTS
// ================================================================

rangeLength = input.int(20, "Range Length")

atrLength = input.int(14, "ATR Length")
atrAverageLength = input.int(50, "ATR Average Length")

volumeLength = input.int(20, "Volume Average")
volumeMultiplier = input.float(1.15, "Volume Multiplier", step = 0.05)

adxLength = input.int(14, "ADX Length")

tpPercent = input.float(2.8, "Take Profit %", step = 0.1)
slPercent = input.float(1.1, "Stop Loss %", step = 0.1)

// ================================================================
// 4H MACRO TREND
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

htfBullish =
     htfClose > htfEma50 and
     htfEma50 > htfEma200

htfBearish =
     htfClose < htfEma50 and
     htfEma50 < htfEma200

// ================================================================
// 15M RANGE
// ================================================================

rangeHigh15 = request.security(
     syminfo.tickerid,
     "15",
     ta.highest(high, rangeLength)[1],
     lookahead = barmerge.lookahead_on
)

rangeLow15 = request.security(
     syminfo.tickerid,
     "15",
     ta.lowest(low, rangeLength)[1],
     lookahead = barmerge.lookahead_on
)

rangeSize15 =
     rangeHigh15 - rangeLow15

atr15 = request.security(
     syminfo.tickerid,
     "15",
     ta.atr(14)[1],
     lookahead = barmerge.lookahead_on
)

compressedRange =
     rangeSize15 < atr15 * 8.0

// ================================================================
// 5M VOLATILITY
// ================================================================

atrValue = ta.atr(atrLength)
atrAverage = ta.sma(atrValue, atrAverageLength)

atrExpansion =
     atrValue > atrAverage * 1.10

volumeAverage = ta.sma(volume, volumeLength)

volumeExpansion =
     volume > volumeAverage * volumeMultiplier

[diPlus, diMinus, adxValue] = ta.dmi(adxLength, adxLength)

// ================================================================
// BREAKOUT
// ================================================================

longBreakout =
     ta.crossover(close, rangeHigh15)

shortBreakout =
     ta.crossunder(close, rangeLow15)

longCondition =
     macroBullish and
     htfBullish and
     compressedRange and
     longBreakout and
     atrExpansion and
     volumeExpansion and
     adxValue > 20

shortCondition =
     macroBearish and
     htfBearish and
     compressedRange and
     shortBreakout and
     atrExpansion and
     volumeExpansion and
     adxValue > 20

if longCondition
    strategy.entry("Long", strategy.long)

if shortCondition
    strategy.entry("Short", strategy.short)

// ================================================================
// TP / SL
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
};

// ================================================================
// GET STRATEGY
// ================================================================

export function getStrategyById(
    id: string
): PineStrategyDefinition | null {
    return STRATEGY_LIBRARY[id] ?? null;
}

// ================================================================
// GET ALL STRATEGIES
// ================================================================

export function getAllStrategies(): PineStrategyDefinition[] {
    return Object.values(STRATEGY_LIBRARY);
}

// ================================================================
// AI STRATEGY CATALOG
// ================================================================

export function getStrategyCatalogForAi() {
    return Object.values(STRATEGY_LIBRARY).map((strategy) => ({
        id: strategy.id,
        name: strategy.name,
        bestMarketConditions: strategy.bestMarketConditions,
        description: strategy.description,
        recommendedTimeframe: strategy.recommendedTimeframe,
        defaultTpPercent: strategy.defaultTpPercent,
        defaultSlPercent: strategy.defaultSlPercent,
    }));
}

// ================================================================
// STRATEGIES BY MARKET CONDITION
// ================================================================

export function getStrategiesForMarketCondition(
    condition:
        | 'trending_bullish'
        | 'trending_bearish'
        | 'ranging_choppy'
        | 'high_volatility_breakout'
        | 'low_volatility_consolidation'
) {
    return Object.values(STRATEGY_LIBRARY).filter((strategy) =>
        strategy.bestMarketConditions.includes(condition)
    );
}
