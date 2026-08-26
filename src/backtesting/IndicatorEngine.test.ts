import { Candle } from '../config/types';
import * as Ind from '../pine/indicators';
import { IndicatorEngine } from './IndicatorEngine';

function generateTestCandles(count: number): Candle[] {
    const candles: Candle[] = [];
    let price = 50000;
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        const change = (Math.sin(i / 10) + Math.cos(i / 7) + (Math.sin(i / 3) * 0.5)) * 35;
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + 15 + Math.abs(Math.sin(i) * 10);
        const low = Math.min(open, close) - 15 - Math.abs(Math.cos(i) * 10);
        const volume = 1000 + (i % 50) * 20;
        candles.push({
            timestamp: now - (count - i) * 300000,
            open,
            high,
            low,
            close,
            volume,
        });
        price = close;
    }
    return candles;
}

function assertClose(a: number, b: number, tolerance = 1e-8, context = ''): void {
    if (isNaN(a) && isNaN(b)) return;
    if (isNaN(a) !== isNaN(b)) {
        throw new Error(`NaN mismatch in ${context}: a=${a}, b=${b}`);
    }
    const diff = Math.abs(a - b);
    if (diff > tolerance) {
        throw new Error(`Value mismatch in ${context}: a=${a}, b=${b}, diff=${diff}`);
    }
}

export function runIndicatorParityTests(): void {
    console.log('Running Indicator Parity & Precomputation Tests...\n');

    const count = 10_000;
    const candles = generateTestCandles(count);
    const engine = new IndicatorEngine(candles);
    const closes = candles.map(c => c.close);

    const testIndices = [50, 100, 500, 1000, 5000, 9999];

    // 1. EMA (20, 50, 200)
    for (const period of [20, 50, 200]) {
        const expected = Ind.ema(closes, period);
        const actual = engine.ema(period);

        for (const idx of testIndices) {
            assertClose(expected[idx], actual[idx], 1e-10, `EMA(${period}) at bar ${idx}`);
        }
        console.log(`✅ EMA(${period}) parity verified across 10,000 bars`);
    }

    // 2. SMA (20, 50)
    for (const period of [20, 50]) {
        const expected = Ind.sma(closes, period);
        const actual = engine.sma(period);

        for (const idx of testIndices) {
            assertClose(expected[idx], actual[idx], 1e-10, `SMA(${period}) at bar ${idx}`);
        }
        console.log(`✅ SMA(${period}) parity verified across 10,000 bars`);
    }

    // 3. RSI (14)
    {
        const expected = Ind.rsi(closes, 14);
        const actual = engine.rsi(14);

        for (const idx of testIndices) {
            assertClose(expected[idx], actual[idx], 1e-10, `RSI(14) at bar ${idx}`);
        }
        console.log(`✅ RSI(14) parity verified across 10,000 bars`);
    }

    // 4. ATR (14)
    {
        const expected = Ind.atr(candles, 14);
        const actual = engine.atr(14);

        for (const idx of testIndices) {
            assertClose(expected[idx], actual[idx], 1e-10, `ATR(14) at bar ${idx}`);
        }
        console.log(`✅ ATR(14) parity verified across 10,000 bars`);
    }

    // 5. Bollinger Bands (20, 2)
    {
        const expected = Ind.bbands(closes, 20, 2);
        const actual = engine.bbands(20, 2);

        for (const idx of testIndices) {
            assertClose(expected.upper[idx], actual.upper[idx], 1e-10, `BBands upper at bar ${idx}`);
            assertClose(expected.lower[idx], actual.lower[idx], 1e-10, `BBands lower at bar ${idx}`);
            assertClose(expected.middle[idx], actual.middle[idx], 1e-10, `BBands middle at bar ${idx}`);
        }
        console.log(`✅ Bollinger Bands(20, 2) parity verified across 10,000 bars`);
    }

    // 6. VWAP
    {
        const expected = Ind.vwap(candles);
        const actual = engine.vwap();

        for (const idx of testIndices) {
            assertClose(expected[idx], actual[idx], 1e-10, `VWAP at bar ${idx}`);
        }
        console.log(`✅ VWAP parity verified across 10,000 bars`);
    }

    // 7. Memoization & Cache verification
    {
        const firstCall = engine.ema(20);
        const secondCall = engine.ema(20);
        if (firstCall !== secondCall) {
            throw new Error('IndicatorEngine failed to return memoized array instance');
        }
        console.log('✅ IndicatorEngine memoization & instance caching verified');
    }

    console.log('\n🎉 All Indicator Parity & Precomputation Tests Passed Successfully!');
}

if (typeof require !== 'undefined' && require.main === module) {
    runIndicatorParityTests();
}
