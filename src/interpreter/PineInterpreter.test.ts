// ================================================================
// BreakoutEx AI — PineInterpreter Test Suite
// ================================================================

import { Candle } from '../config/types';
import { getAllStrategies } from '../backtesting';
import { PineInterpreter } from './PineInterpreter';

function generateCandles(count: number): Candle[] {
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

export function testPineInterpreterClass(): void {
    console.log('Testing PineInterpreter class instance and static methods...\n');

    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', generateCandles(500));
    candleMap.set('15m', generateCandles(200));
    candleMap.set('1h', generateCandles(100));

    const interpreter = new PineInterpreter({ defaultBaseTimeframe: '5m' });
    const strategies = getAllStrategies();

    for (const strategy of strategies) {
        // Instance evaluate
        const res1 = interpreter.evaluate(strategy.pineScript, candleMap);
        // Static evaluate
        const res2 = PineInterpreter.evaluate(strategy.pineScript, candleMap, '5m');

        if (res1.action !== res2.action) {
            throw new Error(`Mismatch between instance & static evaluation for ${strategy.id}`);
        }

        // Data sufficiency check
        const suff = interpreter.analyzeDataSufficiency(strategy.pineScript, '5m', candleMap);
        if (typeof suff.isSufficient !== 'boolean') {
            throw new Error(`Data sufficiency error on ${strategy.id}`);
        }

        // Timeframe extraction
        const tfs = PineInterpreter.extractRequestedTimeframes(strategy.pineScript);
        console.log(`✅ [PASS] ${strategy.id.padEnd(35)} | Signal: ${res1.action.padEnd(6)} | HTF: ${JSON.stringify(tfs)}`);
    }

    console.log(`\nCache count: ${interpreter.getCacheSize()} compiled scripts.`);
    console.log('🎉 PineInterpreter class test passed successfully!\n');
}

if (typeof require !== 'undefined' && require.main === module) {
    testPineInterpreterClass();
}
