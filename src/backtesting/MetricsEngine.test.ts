import { MetricsEngine } from './MetricsEngine';

export function runMetricsEngineTest(): void {
    const result = MetricsEngine.calculate({
        trades: [
            {
                tradeNumber: 1,
                side: 'long',
                entryTimestamp: 1,
                exitTimestamp: 2,
                entryPrice: 100,
                exitPrice: 110,
                entryBarIndex: 0,
                exitBarIndex: 1,
                barsHeld: 1,
                grossPnlPercent: 10,
                netPnlPercent: 10,
                feePercent: 0,
                slippagePercent: 0,
                exitReason: 'tp',
                maxRunUpPercent: 10,
                maxDrawdownPercent: 0,
            },
            {
                tradeNumber: 2,
                side: 'long',
                entryTimestamp: 3,
                exitTimestamp: 4,
                entryPrice: 100,
                exitPrice: 95,
                entryBarIndex: 2,
                exitBarIndex: 3,
                barsHeld: 1,
                grossPnlPercent: -5,
                netPnlPercent: -5,
                feePercent: 0,
                slippagePercent: 0,
                exitReason: 'sl',
                maxRunUpPercent: 0,
                maxDrawdownPercent: 5,
            },
        ],

        equityCurve: [
            {
                timestamp: 1,
                equityPercent: 0,
                equity: 10000,
                drawdownPercent: 0,
            },
            {
                timestamp: 2,
                equityPercent: 10,
                equity: 11000,
                drawdownPercent: 0,
            },
            {
                timestamp: 4,
                equityPercent: 5,
                equity: 10500,
                drawdownPercent: 5,
            },
        ],

        initialCapital: 10000,

        finalCapital: 10500,

        baseTimeframe: '5m',

        minSampleSize: 2,
    });

    if (result.totalTrades !== 2) throw new Error(`Expected totalTrades = 2, got ${result.totalTrades}`);
    if (result.wins !== 1) throw new Error(`Expected wins = 1, got ${result.wins}`);
    if (result.losses !== 1) throw new Error(`Expected losses = 1, got ${result.losses}`);
    if (result.winRate !== 50) throw new Error(`Expected winRate = 50, got ${result.winRate}`);

    console.log('✅ MetricsEngine tests passed successfully!');
}

// Auto-run when executed directly via tsx
if (typeof require !== 'undefined' && require.main === module) {
    runMetricsEngineTest();
}
