import { Candle } from '../config/types';
import { getAllStrategies, STRATEGY_LIBRARY } from './strategy-library';
import { evaluatePineScript, PineEvaluationOptions } from '../interpreter/interpreter';
import { PineExecutionContext, createPineStrategyState } from '../interpreter/PineExecutionContext';
import { IndicatorEngine } from './IndicatorEngine';
import { PineOrderEngine } from './PineOrderEngine';
import { TradingBacktester } from './TradingBacktester';
import { MTFSeriesCache } from './MTFSeriesCache';

function generateRealisticMarket(count = 10_000, startPrice = 50_000): Candle[] {
    const candles: Candle[] = [];
    let price = startPrice;
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);

    for (let i = 0; i < count; i++) {
        // Multi-frequency wave to produce realistic trend and chop cycles
        const wave = Math.sin(i / 15) * 40 + Math.sin(i / 50) * 120 + (i % 2 === 0 ? 15 : -15);
        const open = price;
        const close = price + wave * 0.15;
        const high = Math.max(open, close) + Math.abs(wave) * 0.1 + 10;
        const low = Math.min(open, close) - Math.abs(wave) * 0.1 - 10;
        const volume = 1500 + Math.abs(Math.sin(i / 10)) * 2500;

        candles.push({
            timestamp: start + i * 5 * 60_000,
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

export function testAllStrategiesInAIMode(): void {
    console.log('\n========================================================================================');
    console.log('  🧠 BREAKOUTEX AI MODE: 12 PREDEFINED STRATEGY FAMILIES COMPATIBILITY AUDIT');
    console.log('========================================================================================\n');

    const baseCandles = generateRealisticMarket(12_000, 50_000);
    const mtfCache = new MTFSeriesCache(baseCandles, '5m');

    const candleMap = new Map<string, Candle[]>([
        ['5m', baseCandles],
        ['15m', mtfCache.get('15m')!.candles as Candle[]],
        ['1h', mtfCache.get('1h')!.candles as Candle[]],
        ['4h', mtfCache.get('4h')!.candles as Candle[]],
        ['1d', mtfCache.get('1d')!.candles as Candle[]],
    ]);

    const strategies = getAllStrategies();

    console.log('--- INPUT PARAMETERS & ENVIRONMENT ---');
    console.log(`• Total Base Candles: ${baseCandles.length.toLocaleString()} (5-minute timeframe)`);
    console.log(`• Multi-Timeframes Aggregated: 5m, 15m, 1h, 4h, 1d`);
    console.log(`• AI Confluence Mode: ENABLED (calculateConfluenceScore: true)`);
    console.log(`• Execution Engine: PineOrderEngine (Pyramiding: 1, Friction: 0.05% maker/taker)`);
    console.log(`• Strategy Count: ${strategies.length} production families\n`);

    console.log(
        '#'.padEnd(4) +
        '| Strategy ID'.padEnd(36) +
        '| Regimes Targeted'.padEnd(30) +
        '| AI Signal'.padEnd(12) +
        '| AI Score'.padEnd(10) +
        '| Backtest Status'
    );
    console.log('─'.repeat(105));

    let passCount = 0;

    for (let i = 0; i < strategies.length; i++) {
        const strat = strategies[i];

        // 1. Test in single-bar AI evaluation mode
        const engine = new PineOrderEngine({ initialCapital: 10_000 });
        const lastBar = baseCandles.length - 1;
        const execCtx: PineExecutionContext = {
            currentBarIndex: lastBar,
            testStartIndex: 0,
            currentTimestamp: baseCandles[lastBar].timestamp,
            candles: baseCandles,
            indicators: new IndicatorEngine(baseCandles),
            strategy: createPineStrategyState(10_000),
            orderEngine: engine,
        };

        const aiOptions: PineEvaluationOptions = {
            executionContext: execCtx,
            calculateConfluenceScore: true,
        };

        const aiSignal = evaluatePineScript(strat.pineScript, candleMap, '5m', aiOptions);

        // 2. Test in Full Historical Backtest Mode
        const btResult = TradingBacktester.run({
            strategy: strat,
            candleMap,
            timeframe: '5m',
            options: {
                capital: { initial: 10_000, enabled: true },
                fees: { entryPct: 0.05, exitPct: 0.05 },
            },
        });

        const isPass = btResult && btResult.equityCurve.length > 0;
        if (!isPass) {
            throw new Error(`Strategy ${strat.id} failed backtest run in AI mode`);
        }

        passCount++;
        const targetRegimes = strat.bestMarketConditions.slice(0, 2).join(', ');
        const scoreStr = aiSignal.score !== undefined ? `${aiSignal.score}/100` : 'N/A';

        console.log(
            `[${String(i + 1).padStart(2, '0')}]`.padEnd(4) +
            `| ${strat.id}`.padEnd(36) +
            `| ${targetRegimes}`.padEnd(30) +
            `| ${aiSignal.action.toUpperCase()}`.padEnd(12) +
            `| ${scoreStr}`.padEnd(10) +
            `| ✅ PASS (${btResult.totalTrades} trds, $${btResult.netProfit.toFixed(1)})`
        );
    }

    console.log('─'.repeat(105));
    console.log(`\n🎉 COMPATIBILITY AUDIT PASSED: ${passCount}/${strategies.length} Strategy Families 100% Compatible with AI Mode!\n`);
}

if (typeof require !== 'undefined' && require.main === module) {
    testAllStrategiesInAIMode();
}
