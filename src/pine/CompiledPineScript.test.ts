// ================================================================
// BreakoutEx AI — Compiled Pine Script Parity Tests
// ================================================================

import { Candle } from '../config/types';
import { getAllStrategies } from './strategy-library';
import { evaluatePineScript } from './interpreter';
import { PineScriptCompiler } from './CompiledPineScript';

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

export function runCompiledScriptParityTests(): void {
    console.log('Running Compiled Pine Script Parity Tests across 12 strategies...\n');

    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', generateCandles(500));
    candleMap.set('15m', generateCandles(200));
    candleMap.set('1h', generateCandles(100));
    candleMap.set('4h', generateCandles(50));
    candleMap.set('1d', generateCandles(30));

    const compiler = new PineScriptCompiler();
    const strategies = getAllStrategies();

    let passed = 0;

    for (const strategy of strategies) {
        const compiled = compiler.compile(strategy.pineScript);

        // Run uncompiled (original new Function per call fallback)
        const uncompiledSignal = evaluatePineScript(
            strategy.pineScript,
            candleMap,
            '5m',
            { useCompiledScript: false }
        );

        // Run compiled
        const compiledSignal = evaluatePineScript(
            strategy.pineScript,
            candleMap,
            '5m',
            { useCompiledScript: true, compiledScript: compiled }
        );

        if (uncompiledSignal.action !== compiledSignal.action) {
            throw new Error(
                `Action mismatch in ${strategy.id}: uncompiled=${uncompiledSignal.action}, compiled=${compiledSignal.action}`
            );
        }

        if (uncompiledSignal.tp !== compiledSignal.tp) {
            throw new Error(
                `TP mismatch in ${strategy.id}: uncompiled=${uncompiledSignal.tp}, compiled=${compiledSignal.tp}`
            );
        }

        if (uncompiledSignal.sl !== compiledSignal.sl) {
            throw new Error(
                `SL mismatch in ${strategy.id}: uncompiled=${uncompiledSignal.sl}, compiled=${compiledSignal.sl}`
            );
        }

        console.log(`✅ [PASS] ${strategy.id.padEnd(35)} | Action: ${compiledSignal.action.padEnd(6)} | Parity Verified`);
        passed++;
    }

    console.log(`\n🎉 All ${passed}/${strategies.length} Strategy Compilations Passed Parity Verification!`);
}

if (typeof require !== 'undefined' && require.main === module) {
    runCompiledScriptParityTests();
}
