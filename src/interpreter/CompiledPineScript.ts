// ================================================================
// BreakoutEx AI — Compiled Pine Script
//
// Compiles Pine source once and reuses the generated executable.
//
// IMPORTANT:
// Compilation is separate from execution.
//
// A compiled script must NOT contain candle-specific state.
// Candle/runtime state belongs to PineExecutionContext.
// ================================================================

import {
    transformPineToJs,
    detectPineVersion,
    PineScriptVersion,
} from './interpreter';

// ================================================================
// Compiled function
// ================================================================

export type CompiledPineFunction = (
    strategy: any,
    ta: any,
    request: any,
    barmerge: any,
    input: any,
    color: any,
    math: any,
    syminfo: any,
    timeframe: any,
    array: any,
    barstate: any,
    matrix: any,
    map: any,
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
    last: number,

    // Optional runtime state.
    context?: any
) => void;

// ================================================================
// Compiled representation
// ================================================================

export interface CompiledPineScript {

    /**
     * Original source exactly as supplied.
     */
    readonly source: string;

    /**
     * Transformed JavaScript.
     */
    readonly cleanedSource: string;

    /**
     * Pine version detected during compilation.
     */
    readonly version: PineScriptVersion;

    /**
     * Executable JavaScript function.
     */
    readonly execute: CompiledPineFunction;

    /**
     * Compilation timestamp.
     */
    readonly compiledAt: number;

    /**
     * Whether this script appears to be a strategy.
     */
    readonly isStrategy: boolean;

    /**
     * Whether this script uses request.security().
     */
    readonly usesSecurity: boolean;
}

// ================================================================
// Compiler
// ================================================================

export class PineScriptCompiler {

    private readonly cache =
        new Map<string, CompiledPineScript>();

    // ============================================================
    // Compile
    // ============================================================

    compile(
        source: string
    ): CompiledPineScript {

        if (
            typeof source !== 'string' ||
            !source.trim()
        ) {
            throw new Error(
                'Cannot compile an empty Pine Script.'
            );
        }

        const existing =
            this.cache.get(source);

        if (existing) {
            return existing;
        }

        const cleanedSource =
            transformPineToJs(
                source,
                0
            );

        const version =
            detectPineVersion(source);

        const isStrategy =
            /\bstrategy\s*\(/i.test(source);

        const usesSecurity =
            /\brequest\s*\.\s*security\s*\(/i.test(source) ||
            /\brequest\s*\.\s*security_lower_tf\s*\(/i.test(source);

        let execute: CompiledPineFunction;

        try {
            execute = new Function(
                'strategy',
                'ta',
                'request',
                'barmerge',
                'input',
                'color',
                'math',
                'syminfo',
                'timeframe',
                'array',
                'barstate',
                'matrix',
                'map',

                'nz',
                'na',
                'fixnan',

                'open',
                'high',
                'low',
                'close',
                'volume',

                'hl2',
                'hlc3',
                'ohlc4',

                'bar_index',
                'last',

                'context',

                cleanedSource
            ) as CompiledPineFunction;
        } catch (error) {

            const message =
                error instanceof Error
                    ? error.message
                    : String(error);

            throw new Error(
                `Failed to compile Pine Script v${version}: ${message}`
            );
        }

        const compiled: CompiledPineScript = {
            source,
            cleanedSource,
            version,
            execute,
            compiledAt: Date.now(),
            isStrategy,
            usesSecurity,
        };

        this.cache.set(
            source,
            compiled
        );

        return compiled;
    }

    // ============================================================
    // Cache
    // ============================================================

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }

    has(source: string): boolean {
        return this.cache.has(source);
    }

    get(
        source: string
    ): CompiledPineScript | undefined {
        return this.cache.get(source);
    }

    delete(
        source: string
    ): boolean {
        return this.cache.delete(source);
    }

    // ============================================================
    // Diagnostics
    // ============================================================

    entries(): readonly CompiledPineScript[] {
        return Array.from(
            this.cache.values()
        );
    }
}
