import { Candle } from '../config/types';
import { PineOrderEngine } from './PineOrderEngine';
import { PineExecutionContext, createPineStrategyState, PineStrategyState } from '../interpreter/PineExecutionContext';
import { IndicatorEngine } from './IndicatorEngine';
import { evaluatePineScript } from '../interpreter/interpreter';

function generateCandles(count: number, startPrice = 100): Candle[] {
    const candles: Candle[] = [];
    let price = startPrice;
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);

    for (let i = 0; i < count; i++) {
        const change = (i % 2 === 0 ? 1 : -1) * 2;
        const open = price;
        const close = price + change;
        const high = Math.max(open, close) + 1;
        const low = Math.min(open, close) - 1;
        const volume = 1000;
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

export function testPositionTradeAttributionAudit(): void {
    console.log('Testing Part 10F — Position & Trade Attribution Invariant Audit...');

    const candles = generateCandles(50, 100);

    // ============================================================
    // Test 1: Invariant check during pyramiding and partial exits
    // ============================================================
    {
        const engine = new PineOrderEngine({
            initialCapital: 10_000,
            pyramiding: 5,
            commissionValue: 0.05,
            slippageTicks: 1,
            tickSize: 0.01,
        });

        // Bar 0: Submit Entry 1 (qty 4)
        engine.processBar(0, candles[0]);
        engine.entry('E1', 'long', 4);

        // Bar 1: Fill Entry 1 @ 100
        engine.processBar(1, candles[1]);
        engine.entry('E2', 'long', 6);

        // Bar 2: Fill Entry 2 @ 102
        engine.processBar(2, candles[2]);

        const pos = engine.getPosition();
        // Invariant 1: position_size must match sum of open entries
        const totalOpenQty = pos.entries.reduce((sum, e) => sum + e.qty, 0);
        if (pos.size !== totalOpenQty || pos.size !== 10) {
            throw new Error(`[Invariant Failed] Position size (${pos.size}) != total entries quantity (${totalOpenQty})`);
        }

        // Invariant 2: position_avg_price must match weighted entry costs
        const expectedTotalCost = pos.entries.reduce((sum, e) => sum + e.price * e.qty, 0);
        const expectedAvgPrice = expectedTotalCost / pos.size;
        if (Math.abs(pos.avgPrice - expectedAvgPrice) > 1e-6) {
            throw new Error(`[Invariant Failed] Avg price (${pos.avgPrice}) != calculated weighted avg (${expectedAvgPrice})`);
        }

        // Bar 3: Partial Exit (qty 3)
        engine.exit('ExitPartial', 'E1', 3, undefined, 110);
        engine.processBar(3, {
            timestamp: candles[2].timestamp + 300_000,
            open: 105,
            high: 112,
            low: 104,
            close: 110,
            volume: 1000,
        });

        // Invariant 3: After partial exit, position_size must be 7
        const posAfterExit = engine.getPosition();
        if (posAfterExit.size !== 7) {
            throw new Error(`[Invariant Failed] Post-exit position size expected 7, got ${posAfterExit.size}`);
        }

        // Invariant 4: Net profit must strictly match sum of all realized trades
        const trades = engine.getTrades();
        const sumTradesNetPnl = trades.reduce((sum, t) => sum + t.netPnl, 0);
        if (Math.abs(posAfterExit.realizedPnl - sumTradesNetPnl) > 1e-6) {
            throw new Error(`[Invariant Failed] Realized PnL (${posAfterExit.realizedPnl}) != sum of trade PnLs (${sumTradesNetPnl})`);
        }

        // Invariant 5: Equity = initialCapital + realizedPnl + unrealizedPnl
        const expectedEquity = 10_000 + posAfterExit.realizedPnl + posAfterExit.unrealizedPnl;
        if (Math.abs(posAfterExit.equity - expectedEquity) > 1e-6) {
            throw new Error(`[Invariant Failed] Equity (${posAfterExit.equity}) != Initial + Realized + Unrealized (${expectedEquity})`);
        }

        console.log('  ✓ [PASS] Invariant 1: Position size, VWAP, Realized PnL & Equity Reconciliation');
    }

    // ============================================================
    // Test 2: Invariant check during Reversals
    // ============================================================
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
        engine.processBar(0, { timestamp: candles[0].timestamp, open: 100, high: 101, low: 99, close: 100, volume: 1000 });
        engine.entry('LongPos', 'long', 5);
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1000 }); // filled long 5 @ 100

        // Reverse to short with 8 units
        engine.order('RevShort', 'short', 8);
        engine.processBar(2, {
            timestamp: candles[1].timestamp + 300_000,
            open: 110,
            high: 112,
            low: 108,
            close: 110,
            volume: 1000,
        });

        const pos = engine.getPosition();
        if (pos.side !== 'short' || pos.size !== 3) {
            throw new Error(`[Invariant Failed] Reversal position expected Short size 3, got ${pos.side} ${pos.size}`);
        }

        const trades = engine.getTrades();
        if (trades.length !== 1 || trades[0].quantity !== 5 || trades[0].netPnl !== 50) {
            throw new Error(`[Invariant Failed] Reversal trade expected qty 5 with netPnl 50, got ${trades[0]?.netPnl}`);
        }

        console.log('  ✓ [PASS] Invariant 2: Position Reversal attribution & PnL settlement');
    }

    // ============================================================
    // Test 3: PineStrategyState runtime state sync audit
    // ============================================================
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000 });
        const strategyState: PineStrategyState = createPineStrategyState(10_000);

        engine.processBar(0, candles[0]);
        engine.entry('L', 'long', 2);
        engine.processBar(1, candles[1]);
        engine.syncStrategyState(strategyState);

        if (strategyState.positionDirection !== 'long' || strategyState.positionSize !== 2 || strategyState.opentrades !== 1) {
            throw new Error('[Invariant Failed] Runtime strategy state desynchronized from OrderEngine');
        }

        engine.closeAll();
        engine.processBar(2, candles[2]);
        engine.syncStrategyState(strategyState);

        const currentDir = strategyState.positionDirection as string;
        const currentSize = strategyState.positionSize as number;
        if (currentDir !== 'none' || currentSize !== 0 || strategyState.closedtrades !== 1) {
            throw new Error('[Invariant Failed] Strategy state failed to reflect closed position');
        }

        console.log('  ✓ [PASS] Invariant 3: PineStrategyState runtime synchronization parity');
    }

    console.log('\n🎉 ALL PART 10F POSITION & TRADE ATTRIBUTION AUDITS PASSED!\n');
}

if (typeof require !== 'undefined' && require.main === module) {
    testPositionTradeAttributionAudit();
}
