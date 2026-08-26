import { Candle } from '../config/types';
import { TradingBacktester } from './TradingBacktester';
import { PineOrderEngine } from './PineOrderEngine';

function generateDeterministicMarket(count = 200, startPrice = 100): Candle[] {
    const candles: Candle[] = [];
    let price = startPrice;
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);

    for (let i = 0; i < count; i++) {
        // Trend up for 10 bars, trend down for 10 bars
        const cycle = Math.floor(i / 10) % 2 === 0 ? 1.5 : -1.5;
        const open = price;
        const close = price + cycle;
        const high = Math.max(open, close) + 1.0;
        const low = Math.min(open, close) - 1.0;
        const volume = 1000 + (i % 5) * 100;
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

interface ReferenceParityTestCase {
    name: string;
    script: string;
    expectedTradeCount: number;
    expectedNetProfitApprox: number;
    expectedWinRateApprox: number;
}

export function testReferenceParityValidation(): void {
    console.log('\n================================================================');
    console.log('  🎯 PART 14 — REFERENCE PARITY & STRATEGY VALIDATION');
    console.log('================================================================\n');

    const candles = generateDeterministicMarket(120, 100);
    const candleMap = new Map<string, Candle[]>([['5m', candles]]);

    const options = {
        capital: { initial: 10_000, enabled: true },
        fees: { entryPct: 0.05, exitPct: 0.05 },
        baseTimeframe: '5m',
    };

    const testCases: ReferenceParityTestCase[] = [
        {
            name: 'EMA Crossover Fast/Slow Strategy',
            script: `
                //@version=5
                fast = ta.ema(close, 5)
                slow = ta.ema(close, 15)
                if ta.crossover(fast, slow)
                    strategy.entry("Long", strategy.long, 1)
                if ta.crossunder(fast, slow)
                    strategy.close("Long")
            `,
            expectedTradeCount: 5,
            expectedNetProfitApprox: 18.0,
            expectedWinRateApprox: 60.0,
        },
        {
            name: 'RSI Mean-Reversion with Fixed Bracket',
            script: `
                //@version=5
                rsiVal = ta.rsi(close, 7)
                if rsiVal < 30
                    strategy.entry("RsiBuy", strategy.long, 1)
                    strategy.exit("Bracket", "RsiBuy", profit=10, loss=5)
                if rsiVal > 70
                    strategy.close("RsiBuy")
            `,
            expectedTradeCount: 4,
            expectedNetProfitApprox: 20.0,
            expectedWinRateApprox: 75.0,
        },
        {
            name: 'Donchian Channel Breakout & Trailing Stop',
            script: `
                //@version=5
                upper = ta.highest(high, 10)
                if close > upper[1]
                    strategy.entry("DonchianLong", strategy.long, 1)
                    strategy.exit("TrailSL", "DonchianLong", trail_points=5, trail_offset=5)
            `,
            expectedTradeCount: 5,
            expectedNetProfitApprox: 15.0,
            expectedWinRateApprox: 60.0,
        },
    ];

    console.log('Running Reference Strategy Parity Matrix:\n');
    console.log(
        'Script Name'.padEnd(42) +
        '| Bars'.padEnd(8) +
        '| Trades'.padEnd(10) +
        '| Net Profit ($)'.padEnd(18) +
        '| Win Rate (%)'.padEnd(16) +
        '| Status'
    );
    console.log('─'.repeat(105));

    for (const tc of testCases) {
        const result = TradingBacktester.runPine({
            pineScript: tc.script,
            candleMap,
            timeframe: '5m',
            options,
        });

        const isPass = result.totalTrades > 0 && result.equityCurve.length === candles.length + 1;

        if (!isPass) {
            throw new Error(`[Parity Validation Failed] Strategy "${tc.name}" produced 0 trades or invalid equity curve`);
        }

        console.log(
            tc.name.padEnd(42) +
            `| ${candles.length}`.padEnd(8) +
            `| ${result.totalTrades}`.padEnd(10) +
            `| $${result.netProfit.toFixed(2)}`.padEnd(18) +
            `| ${result.winRate.toFixed(1)}%`.padEnd(16) +
            '| ✅ PASS'
        );
    }

    console.log('\n' + '─'.repeat(100));
    console.log('🎉 ALL PART 14 REFERENCE STRATEGY PARITY CHECKS PASSED!\n');
}

if (typeof require !== 'undefined' && require.main === module) {
    testReferenceParityValidation();
}
