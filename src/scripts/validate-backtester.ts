import { Candle } from '../config/types';
import { getAllStrategies, Backtester } from '../backtesting';

function generateCandleData(count = 500): Map<string, Candle[]> {
    const timeframes = ['5m', '15m', '1h', '4h', '1d'];
    const map = new Map<string, Candle[]>();

    for (const tf of timeframes) {
        const candles: Candle[] = [];
        let price = 50000;
        const now = Date.now();
        const intervalMs = tf === '1d' ? 86400000 : tf === '4h' ? 14400000 : tf === '1h' ? 3600000 : tf === '15m' ? 900000 : 300000;

        for (let i = 0; i < count; i++) {
            const timestamp = now - (count - i) * intervalMs;
            const change = (Math.sin(i / 10) + (Math.random() - 0.48)) * 50;
            const open = price;
            const close = price + change;
            const high = Math.max(open, close) + Math.random() * 30;
            const low = Math.min(open, close) - Math.random() * 30;
            const volume = 1000 + Math.random() * 500;
            candles.push({ timestamp, open, high, low, close, volume });
            price = close;
        }
        map.set(tf, candles);
    }
    return map;
}

export async function validateAllStrategies(): Promise<void> {
    console.log('=== BREAKOUTEX AI — BACKTEST VALIDATOR SUITE ===\n');

    const candleMap = generateCandleData(1000);
    const strategies = getAllStrategies();
    let passedCount = 0;
    let failedCount = 0;

    for (const strategy of strategies) {
        try {
            const result = Backtester.run({
                strategy,
                candleMap,
                options: {
                    baseTimeframe: '5m',
                    windowBars: 500,
                    warmupBars: 200,
                    execution: {
                        sameBarExitPolicy: 'conservative',
                    },
                    diagnostics: {
                        collectSignals: false,
                    },
                },
            });

            const validation = Backtester.validate(result);

            if (validation.valid) {
                console.log(`✅ [PASS] ${strategy.id.padEnd(30)} | Trades: ${result.totalTrades.toString().padEnd(4)} | PnL: ${result.netPnlPercent.toFixed(2)}% | Status: ${result.status}`);
                passedCount++;
            } else {
                console.error(`❌ [FAIL] ${strategy.id.padEnd(30)} | Errors: ${validation.errors}, Warnings: ${validation.warnings}`);
                console.error(validation.issues);
                failedCount++;
            }
        } catch (err: any) {
            console.error(`❌ [EXCEPTION] ${strategy.id.padEnd(30)}:`, err.message);
            failedCount++;
        }
    }

    console.log(`\n==============================================`);
    console.log(`Total: ${strategies.length} | Passed: ${passedCount} | Failed: ${failedCount}`);
    console.log(`==============================================\n`);

    if (failedCount > 0) {
        process.exit(1);
    }
}

if (typeof require !== 'undefined' && require.main === module) {
    validateAllStrategies();
}
