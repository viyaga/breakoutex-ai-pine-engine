// ================================================================
// BreakoutEx AI — Pine Script Interpreter Facade
// ================================================================
//
// Public, reusable interface for the Pine execution subsystem.
//
// IMPORTANT:
// This class is the orchestration/facade layer.
// Actual Pine v5/v6 compatibility is implemented by:
//
//   ./interpreter
//   ./CompiledPineScript
//   ./PineExecutionContext
//   ./SeriesCache
//   ./CandleSeriesView
//   ./indicators
//
// Supported input:
//   - Candle[]
//   - Map<string, Candle[]>
//
// Design goals:
//   - Backwards-compatible public API
//   - Compiler cache reuse
//   - Explicit Pine version detection
//   - Safe compiled-script reuse
//   - Multi-timeframe support
//   - Data sufficiency analysis
//   - Timeframe utilities
// ================================================================

import { Candle, PineSignal } from '../config/types';

import {
    CompiledPineScript,
    PineScriptCompiler,
} from './CompiledPineScript';

import {
    evaluatePineScript,
    analyzeDataSufficiency,
    extractRequestedTimeframes,
    normalizeTimeframe,
    parseTimeframeToMinutes,
    transformPineToJs,
    detectPineVersion,
    PineEvaluationOptions,
    DataSufficiencyRequirement,
    PineScriptVersion,
} from './interpreter';

// ================================================================
// Types
// ================================================================

export interface PineInterpreterConfig {
    /**
     * Optional compiler instance.
     *
     * Supplying one allows multiple interpreter instances to share
     * the same compilation cache.
     */
    compiler?: PineScriptCompiler;

    /**
     * Default timeframe used when the caller does not explicitly
     * provide one.
     *
     * Example:
     *   "5m"
     *   "15m"
     *   "1h"
     */
    defaultBaseTimeframe?: string;

    /**
     * Whether compiled-script caching should be enabled.
     *
     * Defaults to true.
     */
    useCompilerCache?: boolean;
}

export interface PineEvaluationInput {
    /**
     * Base timeframe of the supplied candle series.
     */
    baseTimeframe?: string;

    /**
     * Optional precompiled Pine script.
     */
    compiledScript?: CompiledPineScript;

    /**
     * Whether the interpreter should use compilation/cache.
     *
     * Defaults to true.
     */
    useCompiledScript?: boolean;
}

export interface PineScriptMetadata {
    /**
     * Pine language version detected from the script.
     *
     * Example:
     *   5
     *   6
     */
    version: PineScriptVersion;

    /**
     * Timeframes explicitly requested by request.security().
     */
    requestedTimeframes: string[];

    /**
     * Normalized requested timeframes.
     */
    normalizedTimeframes: string[];

    /**
     * Whether the script appears to use MTF functionality.
     */
    isMultiTimeframe: boolean;

    /**
     * Whether the script contains strategy declarations.
     */
    isStrategy: boolean;

    /**
     * Whether the script contains indicator declarations.
     */
    isIndicator: boolean;
}

// ================================================================
// PineInterpreter
// ================================================================

export class PineInterpreter {
    private readonly compiler: PineScriptCompiler;
    private readonly defaultBaseTimeframe: string;
    private readonly useCompilerCache: boolean;

    private static defaultInstance: PineInterpreter | undefined;

    // ============================================================
    // Constructor
    // ============================================================

    constructor(config: PineInterpreterConfig = {}) {
        this.compiler = config.compiler ?? new PineScriptCompiler();

        this.defaultBaseTimeframe = normalizeTimeframe(
            config.defaultBaseTimeframe ?? '5m'
        );

        this.useCompilerCache = config.useCompilerCache ?? true;
    }

    // ============================================================
    // Singleton
    // ============================================================

    /**
     * Returns the shared default interpreter instance.
     *
     * Useful for:
     *
     *   PineInterpreter.getInstance().evaluate(...)
     */
    public static getInstance(): PineInterpreter {
        if (!PineInterpreter.defaultInstance) {
            PineInterpreter.defaultInstance = new PineInterpreter();
        }

        return PineInterpreter.defaultInstance;
    }

    /**
     * Replaces the default singleton instance.
     *
     * Useful for applications that want to configure the default
     * interpreter globally.
     */
    public static configureDefault(
        config: PineInterpreterConfig = {}
    ): PineInterpreter {
        PineInterpreter.defaultInstance = new PineInterpreter(config);
        return PineInterpreter.defaultInstance;
    }

    // ============================================================
    // Evaluation
    // ============================================================

    /**
     * Evaluates a Pine Script strategy.
     *
     * Supports:
     *
     *   Candle[]
     *
     * and:
     *
     *   Map<string, Candle[]>
     *
     * for multi-timeframe execution.
     */
    public evaluate(
        script: string,
        candlesInput: Candle[] | Map<string, Candle[]>,
        baseTimeframe?: string,
        options: PineEvaluationOptions = {}
    ): PineSignal {
        this.assertValidScript(script);
        this.assertValidCandleInput(candlesInput);

        const timeframe = normalizeTimeframe(
            baseTimeframe ?? this.defaultBaseTimeframe
        );

        let compiledScript = options.compiledScript;

        /*
         * Compile only when:
         *
         * 1. compilation is enabled
         * 2. caller did not already provide a compiled script
         */
        if (
            this.useCompilerCache &&
            (options.useCompiledScript ?? true) &&
            !compiledScript
        ) {
            compiledScript = this.compiler.compile(script);
        }

        return evaluatePineScript(
            script,
            candlesInput,
            timeframe,
            {
                ...options,
                compiledScript,
                useCompiledScript:
                    options.useCompiledScript ??
                    this.useCompilerCache,
            }
        );
    }

    /**
     * Evaluates using an explicit evaluation input object.
     *
     * This is useful when the caller wants to avoid positional
     * arguments.
     */
    public evaluateWithInput(
        script: string,
        candlesInput: Candle[] | Map<string, Candle[]>,
        input: PineEvaluationInput = {}
    ): PineSignal {
        return this.evaluate(
            script,
            candlesInput,
            input.baseTimeframe,
            {
                ...input,
            }
        );
    }

    /**
     * Static convenience API.
     */
    public static evaluate(
        script: string,
        candlesInput: Candle[] | Map<string, Candle[]>,
        baseTimeframe = '5m',
        options: PineEvaluationOptions = {}
    ): PineSignal {
        return PineInterpreter.getInstance().evaluate(
            script,
            candlesInput,
            baseTimeframe,
            options
        );
    }

    // ============================================================
    // Compilation
    // ============================================================

    /**
     * Compiles a Pine Script and stores/reuses the compiled result
     * through the configured PineScriptCompiler.
     */
    public compile(script: string): CompiledPineScript {
        this.assertValidScript(script);

        return this.compiler.compile(script);
    }

    /**
     * Static compile helper.
     */
    public static compile(script: string): CompiledPineScript {
        return PineInterpreter.getInstance().compile(script);
    }

    /**
     * Clears the compiler cache.
     */
    public clearCache(): void {
        this.compiler.clear();
    }

    /**
     * Static cache clear helper.
     */
    public static clearCache(): void {
        PineInterpreter.getInstance().clearCache();
    }

    /**
     * Returns the number of compiled scripts currently cached.
     */
    public getCacheSize(): number {
        return this.compiler.size();
    }

    /**
     * Static cache-size helper.
     */
    public static getCacheSize(): number {
        return PineInterpreter.getInstance().getCacheSize();
    }

    // ============================================================
    // Pine Version
    // ============================================================

    /**
     * Detects the Pine Script version.
     *
     * Expected:
     *
     *   //@version=5
     *
     * or:
     *
     *   //@version=6
     *
     * If no explicit version is present, the underlying parser
     * determines the default behavior.
     */
    public detectVersion(script: string): PineScriptVersion {
        this.assertValidScript(script);

        return detectPineVersion(script);
    }

    /**
     * Static version detection helper.
     */
    public static detectVersion(script: string): PineScriptVersion {
        return PineInterpreter.getInstance().detectVersion(script);
    }

    // ============================================================
    // Script Metadata
    // ============================================================

    /**
     * Extracts useful metadata from a Pine script without executing it.
     */
    public getMetadata(script: string): PineScriptMetadata {
        this.assertValidScript(script);

        const version = detectPineVersion(script);

        const requestedTimeframes =
            extractRequestedTimeframes(script);

        const normalizedTimeframes = requestedTimeframes
            .map(tf => {
                try {
                    return normalizeTimeframe(tf);
                } catch {
                    return tf;
                }
            });

        const lowerScript = script.toLowerCase();

        const isStrategy =
            /\bstrategy\s*\(/i.test(script);

        const isIndicator =
            /\bindicator\s*\(/i.test(script) ||
            /\bstudy\s*\(/i.test(script);

        const isMultiTimeframe =
            requestedTimeframes.length > 0 ||
            /\brequest\s*\.\s*security\s*\(/i.test(script) ||
            /\bsecurity\s*\(/i.test(script);

        return {
            version,
            requestedTimeframes,
            normalizedTimeframes,
            isMultiTimeframe,
            isStrategy,
            isIndicator,
        };
    }

    /**
     * Static metadata helper.
     */
    public static getMetadata(script: string): PineScriptMetadata {
        return PineInterpreter.getInstance().getMetadata(script);
    }

    // ============================================================
    // Data Sufficiency
    // ============================================================

    /**
     * Analyzes whether the supplied candle history is sufficient
     * for the script.
     *
     * This is especially important for:
     *
     *   ta.sma(close, 200)
     *   ta.ema(close, 200)
     *   close[100]
     *   request.security(...)
     */
    public analyzeDataSufficiency(
        script: string,
        baseTimeframe?: string,
        candleMap?: Map<string, Candle[]> | Record<string, any[]>,
        baseCandlesCount?: number
    ): DataSufficiencyRequirement & {
        isSufficient: boolean;
    } {
        this.assertValidScript(script);

        return analyzeDataSufficiency(
            script,
            normalizeTimeframe(
                baseTimeframe ?? this.defaultBaseTimeframe
            ),
            candleMap,
            baseCandlesCount
        );
    }

    /**
     * Static data-sufficiency helper.
     */
    public static analyzeDataSufficiency(
        script: string,
        baseTimeframe = '5m',
        candleMap?: Map<string, Candle[]> | Record<string, any[]>,
        baseCandlesCount?: number
    ): DataSufficiencyRequirement & {
        isSufficient: boolean;
    } {
        return PineInterpreter.getInstance().analyzeDataSufficiency(
            script,
            baseTimeframe,
            candleMap,
            baseCandlesCount
        );
    }

    // ============================================================
    // Multi-Timeframe
    // ============================================================

    /**
     * Extracts timeframe identifiers requested by the script.
     *
     * Example:
     *
     *   request.security(..., "15", ...)
     *   request.security(..., "60", ...)
     *
     * might return:
     *
     *   ["15", "60"]
     */
    public extractRequestedTimeframes(script: string): string[] {
        this.assertValidScript(script);

        return extractRequestedTimeframes(script);
    }

    /**
     * Static timeframe extraction helper.
     */
    public static extractRequestedTimeframes(
        script: string
    ): string[] {
        return PineInterpreter.getInstance()
            .extractRequestedTimeframes(script);
    }

    /**
     * Extracts normalized timeframe identifiers.
     */
    public extractNormalizedTimeframes(script: string): string[] {
        return this.extractRequestedTimeframes(script)
            .map(tf => normalizeTimeframe(tf));
    }

    /**
     * Static normalized timeframe helper.
     */
    public static extractNormalizedTimeframes(
        script: string
    ): string[] {
        return PineInterpreter.getInstance()
            .extractNormalizedTimeframes(script);
    }

    // ============================================================
    // Timeframe Utilities
    // ============================================================

    /**
     * Normalizes a Pine timeframe.
     *
     * Examples:
     *
     *   "60"  -> "1h"
     *   "240" -> "4h"
     *   "D"   -> "1d"
     */
    public normalizeTimeframe(
        timeframe: string | number
    ): string {
        return normalizeTimeframe(timeframe);
    }

    /**
     * Static timeframe normalization helper.
     */
    public static normalizeTimeframe(
        timeframe: string | number
    ): string {
        return normalizeTimeframe(timeframe);
    }

    /**
     * Converts a Pine timeframe into minutes.
     */
    public parseTimeframeToMinutes(
        timeframe: string | number
    ): number {
        return parseTimeframeToMinutes(timeframe);
    }

    /**
     * Static timeframe parser.
     */
    public static parseTimeframeToMinutes(
        timeframe: string | number
    ): number {
        return parseTimeframeToMinutes(timeframe);
    }

    // ============================================================
    // Pine → JavaScript
    // ============================================================

    /**
     * Transforms Pine Script into executable JavaScript.
     *
     * NOTE:
     *
     * This method is intentionally exposed for debugging and
     * compiler inspection.
     *
     * It should NOT be considered proof of complete Pine v5/v6
     * compatibility.
     */
    public transformToJs(
        script: string,
        targetBarIndex = 0
    ): string {
        this.assertValidScript(script);

        return transformPineToJs(
            script,
            targetBarIndex
        );
    }

    /**
     * Static Pine → JS helper.
     */
    public static transformToJs(
        script: string,
        targetBarIndex = 0
    ): string {
        return PineInterpreter.getInstance()
            .transformToJs(script, targetBarIndex);
    }

    // ============================================================
    // Configuration
    // ============================================================

    /**
     * Returns the default timeframe configured for this instance.
     */
    public getDefaultBaseTimeframe(): string {
        return this.defaultBaseTimeframe;
    }

    /**
     * Returns whether compiler caching is enabled.
     */
    public isCompilerCacheEnabled(): boolean {
        return this.useCompilerCache;
    }

    /**
     * Returns the compiler instance.
     *
     * Exposed primarily for diagnostics/testing.
     */
    public getCompiler(): PineScriptCompiler {
        return this.compiler;
    }

    // ============================================================
    // Validation
    // ============================================================

    private assertValidScript(script: string): void {
        if (typeof script !== 'string') {
            throw new TypeError(
                'Pine script must be a string.'
            );
        }

        if (script.trim().length === 0) {
            throw new Error(
                'Pine script cannot be empty.'
            );
        }
    }

    private assertValidCandleInput(
        candlesInput: Candle[] | Map<string, Candle[]>
    ): void {
        if (Array.isArray(candlesInput)) {
            return;
        }

        if (
            candlesInput instanceof Map
        ) {
            return;
        }

        throw new TypeError(
            'Pine candle input must be Candle[] or Map<string, Candle[]>.'
        );
    }
}

// ================================================================
// Public exports
// ================================================================

export {
    CompiledPineScript,
    PineScriptCompiler,
    PineEvaluationOptions,
    DataSufficiencyRequirement,
    PineScriptVersion,
};
