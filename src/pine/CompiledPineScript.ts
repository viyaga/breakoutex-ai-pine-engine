// ================================================================
// BreakoutEx AI — Compiled Pine Script
//
// Compiles the translated Pine JavaScript ONCE per script source.
//
// Execution function takes the exact argument list used by evaluatePineScript.
// ================================================================

import { transformPineToJs } from './interpreter';

export type CompiledPineFunction = (
    strategy: any,
    ta: any,
    request: any,
    input: any,
    color: any,
    math: any,
    syminfo: any,
    timeframe: any,
    nz: any,
    na: any,
    fixnan: any,
    open: any,
    high: any,
    low: any,
    close: any,
    volume: any,
    hl2: any,
    hlc3: any,
    ohlc4: any,
    bar_index: number,
    last: number
) => void;

export interface CompiledPineScript {
    source: string;
    cleanedSource: string;
    execute: CompiledPineFunction;
}

export class PineScriptCompiler {
    private readonly cache = new Map<string, CompiledPineScript>();

    compile(source: string): CompiledPineScript {
        const existing = this.cache.get(source);
        if (existing) {
            return existing;
        }

        const cleanedSource = transformPineToJs(source, 0);

        const execute = new Function(
            'strategy', 'ta', 'request', 'input', 'color', 'math', 'syminfo', 'timeframe',
            'nz', 'na', 'fixnan',
            'open', 'high', 'low', 'close', 'volume',
            'hl2', 'hlc3', 'ohlc4',
            'bar_index', 'last',
            cleanedSource
        ) as CompiledPineFunction;

        const compiled: CompiledPineScript = {
            source,
            cleanedSource,
            execute,
        };

        this.cache.set(source, compiled);
        return compiled;
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}
