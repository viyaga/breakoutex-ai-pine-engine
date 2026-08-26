import { Candle } from '../config/types';
import { PineOrderEngine } from './PineOrderEngine';
import { evaluatePineScript } from '../interpreter/interpreter';
import { PineExecutionContext, createPineStrategyState } from '../interpreter/PineExecutionContext';
import { IndicatorEngine } from './IndicatorEngine';

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

export function testPineOrderEngineMasterSuite(): void {
    console.log('Testing PineOrderEngine Master Suite (Parts 10B, 10C, 10D, 10E)...');

    const candles = generateCandles(30, 100);

    // ============================================================
    // Part 10B: strategy.entry()
    // ============================================================
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
        engine.processBar(0, candles[0]);
        engine.entry('Long1', 'long', 2);
        engine.processBar(1, candles[1]);

        const pos = engine.getPosition();
        if (pos.side !== 'long' || pos.size !== 2) throw new Error('[10B.1 Failed]');
        console.log('  ✓ [PASS] 10B.1 Long market entry');
    }

    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
        engine.processBar(0, candles[0]);
        engine.entry('Long1', 'long', 1);
        engine.processBar(1, candles[1]);

        engine.entry('Short1', 'short', 1);
        engine.processBar(2, candles[2]);

        const pos = engine.getPosition();
        if (pos.side !== 'short' || pos.size !== 1) throw new Error('[10B.3 Failed]');
        console.log('  ✓ [PASS] 10B.3 Long → Short reversal');
    }

    // ============================================================
    // Part 10C: strategy.order() & OCA
    // ============================================================
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
        engine.processBar(0, candles[0]);
        engine.order('Buy10', 'long', 10);
        engine.processBar(1, candles[1]); // filled LONG 10

        engine.order('Reduce4', 'short', 4);
        engine.processBar(2, candles[2]); // filled SHORT 4

        const pos = engine.getPosition();
        if (pos.side !== 'long' || pos.size !== 6) throw new Error('[10C.7 Failed]');
        console.log('  ✓ [PASS] 10C.7 Direct partial reduction (LONG 10 -> LONG 6)');
    }

    // ============================================================
    // Part 10D: strategy.exit() Bracket, Trailing Stops, from_entry
    // ============================================================
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
        engine.processBar(0, candles[0]);
        engine.entry('L1', 'long', 1);
        engine.processBar(1, candles[1]); // filled at 100

        engine.exit('Exit_L1', 'L1', 1, undefined, 110, undefined, 90);

        engine.processBar(2, {
            timestamp: candles[1].timestamp + 300_000,
            open: 101,
            high: 112,
            low: 99,
            close: 108,
            volume: 1000,
        });

        const pos = engine.getPosition();
        if (pos.side !== 'flat') throw new Error(`[10D.1 Failed] Position should be flat after TP fill`);
        console.log('  ✓ [PASS] 10D.1 Absolute TP/SL Bracket (TP filled, SL discarded)');
    }

    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0, tickSize: 1 });
        engine.processBar(0, candles[0]);
        engine.entry('TrailLong', 'long', 1);
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1000 });

        engine.exit('TrailExit', 'TrailLong', 1, undefined, undefined, undefined, undefined, undefined, 5, 5);

        engine.processBar(2, { timestamp: candles[0].timestamp + 600_000, open: 102, high: 110, low: 101, close: 108, volume: 1000 });
        engine.processBar(3, { timestamp: candles[0].timestamp + 900_000, open: 109, high: 120, low: 108, close: 118, volume: 1000 });
        engine.processBar(4, { timestamp: candles[0].timestamp + 1200_000, open: 116, high: 117, low: 114, close: 115, volume: 1000 });

        const trades = engine.getTrades();
        if (trades.length !== 1 || trades[0].exitPrice !== 115 || !trades[0].isWinner) {
            throw new Error(`[10D.5 Failed] Trailing stop fill expected at 115, got ${trades[0]?.exitPrice}`);
        }
        console.log('  ✓ [PASS] 10D.5 Trailing Stop ratcheting & execution');
    }

    // ============================================================
    // Part 10E: strategy.close(), close_all(), cancel(), cancel_all()
    // ============================================================

    // 10E.1: strategy.close(id) with specific trade ID & partial close
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, pyramiding: 2, slippageTicks: 0, commissionValue: 0 });
        engine.processBar(0, candles[0]);
        engine.entry('Trade1', 'long', 5);
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1000 });

        engine.entry('Trade2', 'long', 5);
        engine.processBar(2, { timestamp: candles[0].timestamp + 600_000, open: 110, high: 111, low: 109, close: 110, volume: 1000 });

        // Close Trade1 specifically (qty 5)
        engine.close('Trade1');
        engine.processBar(3, { timestamp: candles[0].timestamp + 900_000, open: 115, high: 116, low: 114, close: 115, volume: 1000 });

        const pos = engine.getPosition();
        if (pos.side !== 'long' || pos.size !== 5) {
            throw new Error(`[10E.1 Failed] Expected remaining position size 5, got ${pos.size}`);
        }
        const trades = engine.getTrades();
        if (trades.length !== 1 || trades[0].entryId !== 'Trade1' || trades[0].quantity !== 5) {
            throw new Error(`[10E.1 Failed] Closed trade expected for Trade1 qty 5`);
        }
        console.log('  ✓ [PASS] 10E.1 strategy.close(id) targeted trade closing');
    }

    // 10E.2: strategy.close_all()
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
        engine.processBar(0, candles[0]);
        engine.entry('LongAll', 'long', 10);
        engine.processBar(1, candles[1]);

        engine.closeAll('Emergency Close');
        engine.processBar(2, candles[2]);

        const pos = engine.getPosition();
        if (pos.side !== 'flat' || pos.size !== 0) {
            throw new Error(`[10E.2 Failed] Position expected flat after close_all, got ${pos.side} ${pos.size}`);
        }
        const trades = engine.getTrades();
        if (trades.length !== 1 || trades[0].quantity !== 10) {
            throw new Error(`[10E.2 Failed] Expected 1 trade for 10 units`);
        }
        console.log('  ✓ [PASS] 10E.2 strategy.close_all() full flat execution');
    }

    // 10E.3: strategy.cancel() and cancel_all() leaving active position untouched
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0 });
        engine.processBar(0, candles[0]);
        engine.entry('FilledLong', 'long', 2);
        engine.processBar(1, candles[1]); // filled 2

        // Queue a limit order and an exit
        engine.order('PendingLimit', 'long', 5, 80);
        engine.exit('ExitSL', 'FilledLong', 2, undefined, undefined, undefined, 70);

        if (engine.getPendingOrders().length !== 2) {
            throw new Error(`[10E.3 Failed] Expected 2 pending orders`);
        }

        // Cancel the limit order specifically
        engine.cancel('PendingLimit');
        if (engine.getPendingOrders().length !== 1 || engine.getPendingOrders()[0].id !== 'ExitSL') {
            throw new Error(`[10E.3 Failed] cancel(id) failed to remove targeted pending order`);
        }

        // Cancel all remaining orders
        engine.cancelAll();
        if (engine.getPendingOrders().length !== 0) {
            throw new Error(`[10E.3 Failed] cancel_all() failed to clear orders`);
        }

        // Verify active position is still intact!
        const pos = engine.getPosition();
        if (pos.side !== 'long' || pos.size !== 2) {
            throw new Error(`[10E.3 Failed] Active position must remain untouched after cancellation! Got ${pos.side} ${pos.size}`);
        }
        console.log('  ✓ [PASS] 10E.3 strategy.cancel() and cancel_all() with position invariance');
    }

    // 10E.4: Pine Interpreter integration for close & cancel
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000 });
        const strategyState = createPineStrategyState(10_000);
        const execCtx: PineExecutionContext = {
            currentBarIndex: 0,
            testStartIndex: 0,
            currentTimestamp: candles[0].timestamp,
            candles: candles,
            indicators: new IndicatorEngine(candles),
            strategy: strategyState,
            orderEngine: engine,
        };

        const script = `
            strategy.entry("LongTest", strategy.long, qty=2)
            strategy.close("LongTest", qty=1, comment="Partial Close")
            strategy.cancel("NonExistent")
        `;

        const candleMap = new Map<string, Candle[]>([['5m', candles]]);
        evaluatePineScript(script, candleMap, '5m', { executionContext: execCtx });

        const pending = engine.getPendingOrders();
        if (pending.length !== 2) {
            throw new Error(`[10E.4 Failed] Expected entry and close orders, got ${pending.length}`);
        }
        console.log('  ✓ [PASS] 10E.4 Pine Interpreter -> close() & cancel() wiring');
    }

    console.log('\n🎉 ALL MASTER ORDER & EXECUTION TESTS PASSED (10B, 10C, 10D, 10E)!\n');
}

if (typeof require !== 'undefined' && require.main === module) {
    testPineOrderEngineMasterSuite();
}
