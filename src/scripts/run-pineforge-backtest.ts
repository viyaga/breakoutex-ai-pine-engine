// ================================================================
// BreakoutEx AI — PineForge Engine Backtester CLI
// Backtests all 12 institutional MTF Pine Script strategies against
// live historical multi-timeframe candle data (5m, 15m, 1h, 4h).
// ================================================================

import { Candle } from '../config/types';
import {
    getAllStrategies,
    PineStrategyDefinition,
    BacktestResult,
    Backtester,
    exportStrategiesToPineFiles,
    exportCandlesToCsv
} from '../backtesting';

interface SymbolBacktestSummary {
    symbol: string;
    candleCounts: Record<string, number>;
    results: BacktestResult[];
}

/**
 * Fetch historical candles from public Binance Futures Kline API
 */
async function fetchBinanceKlines(symbol: string, interval: string, limit: number = 1000): Promise<Candle[]> {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`Failed to fetch ${interval} klines for ${symbol}: HTTP ${resp.status} ${resp.statusText}`);
    }
    const rawData = (await resp.json()) as any[][];

    return rawData.map(d => ({
        timestamp: Number(d[0]),
        open: Number(d[1]),
        high: Number(d[2]),
        low: Number(d[3]),
        close: Number(d[4]),
        volume: Number(d[5]),
    }));
}

/**
 * Format status with visual indicators
 */
function formatStatus(status: string): string {
    switch (status) {
        case 'profitable':
            return 'PROFITABLE 🟢';
        case 'neutral':
            return 'NEUTRAL    ⚪';
        case 'losing':
            return 'LOSING     🔴';
        case 'insufficient_sample':
            return 'LOW SAMPLE 🟡';
        case 'no_triggers':
            return 'NO TRIGGER ⚪';
        default:
            return status;
    }
}

async function runBacktestsForSymbol(symbol: string): Promise<SymbolBacktestSummary> {
    console.log(`\n================================================================`);
    console.log(`Fetching Multi-Timeframe Historical Data for: ${symbol}`);
    console.log(`================================================================`);

    const candleMap = new Map<string, Candle[]>();

    const intervals = [
        { tf: '5m', limit: 1000 },
        { tf: '15m', limit: 800 },
        { tf: '1h', limit: 500 },
        { tf: '4h', limit: 300 },
    ];

    const candleCounts: Record<string, number> = {};

    for (const item of intervals) {
        process.stdout.write(`Fetching ${symbol} [${item.tf.padEnd(3)}] (${item.limit} bars)... `);
        try {
            const candles = await fetchBinanceKlines(symbol, item.tf, item.limit);
            candleMap.set(item.tf, candles);
            candleCounts[item.tf] = candles.length;
            console.log(`✓ (${candles.length} candles loaded, range: ${new Date(candles[0].timestamp).toISOString().slice(0, 16)} to ${new Date(candles[candles.length - 1].timestamp).toISOString().slice(0, 16)})`);
        } catch (e: any) {
            console.log(`✗ Error: ${e.message}`);
        }
    }

    console.log(`\nSimulating all 12 MTF Pine Script strategies with 4-tick intrabar & 0.14% friction...`);

    const allStrategies = getAllStrategies();
    const results = Backtester.runMany(allStrategies, candleMap, { baseTimeframe: '5m', windowBars: 1000 });

    // Export klines to CSV for PineForge C++ interop
    exportCandlesToCsv(symbol, candleMap);

    return {
        symbol,
        candleCounts,
        results,
    };
}

function printSummaryTable(summary: SymbolBacktestSummary) {
    console.log(`\n==========================================================================================================================================`);
    console.log(`📊 PINEFORGE ENGINE INSTITUTIONAL REPORT: ${summary.symbol.toUpperCase()} (Base: 5m | MTF: 15m, 1h, 4h)`);
    console.log(`==========================================================================================================================================`);
    console.log(
        `#  | Strategy ID                     | Trades | Win%   | Net PnL% | Profit Factor | Sharpe | Sortino | Payoff | Max DD% | Status`
    );
    console.log(`------------------------------------------------------------------------------------------------------------------------------------------`);

    summary.results.forEach((r, idx) => {
        const num = String(idx + 1).padStart(2, '0');
        const stratId = r.strategyId.padEnd(31);
        const trades = String(r.totalTrades).padStart(6);
        const winRate = `${r.winRate.toFixed(1)}%`.padStart(6);
        const netPnl = `${r.netPnlPercent >= 0 ? '+' : ''}${r.netPnlPercent.toFixed(2)}%`.padStart(8);
        const pf = r.profitFactor.toFixed(2).padStart(13);
        const sharpe = r.sharpeRatio.toFixed(2).padStart(6);
        const sortino = r.sortinoRatio.toFixed(2).padStart(7);
        const payoff = r.payoffRatio.toFixed(2).padStart(6);
        const maxDd = `${r.maxDrawdownPercent.toFixed(2)}%`.padStart(7);
        const status = formatStatus(r.status);

        console.log(`${num} | ${stratId} | ${trades} | ${winRate} | ${netPnl} | ${pf} | ${sharpe} | ${sortino} | ${payoff} | ${maxDd} | ${status}`);
    });

    console.log(`------------------------------------------------------------------------------------------------------------------------------------------`);

    const profitable = summary.results.filter(r => r.status === 'profitable');
    const best = summary.results[0];

    console.log(`🏆 Top Ranked Strategy: ${best.strategyName} (${best.strategyId})`);
    console.log(`📈 Profitable Strategies: ${profitable.length} / ${summary.results.length}`);

    // Print detailed trade ledger for best strategy if it took trades
    if (best.trades.length > 0) {
        console.log(`\nTrade Ledger for Top Strategy [${best.strategyId}]:`);
        console.log(`Trade# | Side  | Entry Price | Exit Price  | PnL%     | Bars | Exit Reason   | Max Run-up% | Max Drawdown%`);
        console.log(`-------------------------------------------------------------------------------------------------------`);
        best.trades.forEach(t => {
            const num = String(t.tradeNumber).padStart(6);
            const side = t.side.toUpperCase().padEnd(5);
            const entry = t.entryPrice.toFixed(2).padStart(11);
            const exit = t.exitPrice.toFixed(2).padStart(11);
            const pnl = `${t.netPnlPercent >= 0 ? '+' : ''}${t.netPnlPercent.toFixed(2)}%`.padStart(8);
            const bars = String(t.barsHeld).padStart(4);
            const reason = t.exitReason.padEnd(13);
            const runup = `+${t.maxRunUpPercent.toFixed(2)}%`.padStart(11);
            const dd = `-${t.maxDrawdownPercent.toFixed(2)}%`.padStart(13);
            console.log(`${num} | ${side} | ${entry} | ${exit} | ${pnl} | ${bars} | ${reason} | ${runup} | ${dd}`);
        });
        console.log(`-------------------------------------------------------------------------------------------------------`);
    }
}

async function main() {
    const symbols = process.argv.slice(2).length > 0
        ? process.argv.slice(2)
        : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

    console.log(`\nStarting PineForge-Parity Institutional Multi-Strategy Backtest Runner...`);
    console.log(`Target Assets: ${symbols.join(', ')}`);

    // Export all strategies to .pine files
    const exportedPine = exportStrategiesToPineFiles();
    console.log(`Exported ${exportedPine.length} strategies to standalone .pine files in ./pine-exports`);

    const allSummaries: SymbolBacktestSummary[] = [];

    for (const sym of symbols) {
        try {
            const summary = await runBacktestsForSymbol(sym);
            printSummaryTable(summary);
            allSummaries.push(summary);
        } catch (err: any) {
            console.error(`Failed backtesting for ${sym}:`, err.message);
        }
    }

    console.log(`\n==========================================================================================================================================`);
    console.log(`🏁 PineForge Institutional Backtesting Completed Across ${allSummaries.length} Asset(s)!`);
    console.log(`==========================================================================================================================================\n`);
}

main().catch(err => {
    console.error('Fatal error running backtest:', err);
    process.exit(1);
});
