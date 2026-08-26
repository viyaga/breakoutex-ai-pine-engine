import { Candle } from '../config/types';
import { PineOrderEngine } from './PineOrderEngine';

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

export function testExecutionTimingAudit(): void {
    console.log('Testing Part 10H — Execution Timing & Gap Fill Audit...');

    const candles = generateCandles(10, 100);

    // ============================================================
    // 1. Default Execution Timing (Order on Bar N executes on Bar N+1 Open)
    // ============================================================
    {
        const engine = new PineOrderEngine({
            initialCapital: 10_000,
            processOrdersOnClose: false,
            slippageTicks: 0,
            commissionValue: 0,
        });

        // Bar 0: Signal generated & entry queued
        engine.processBar(0, candles[0]);
        engine.entry('L1', 'long', 1);

        // At bar 0 end: position is still flat (order is pending for next bar)
        if (engine.getPosition().side !== 'flat') {
            throw new Error('[10H.1 Failed] Order should not fill on current bar under default execution timing');
        }

        // Bar 1: Fills at Bar 1 Open
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 102.5, high: 104, low: 101, close: 103, volume: 1000 });

        const pos = engine.getPosition();
        if (pos.side !== 'long' || pos.avgPrice !== 102.5 || pos.openBarIndex !== 1) {
            throw new Error(`[10H.1 Failed] Expected fill on Bar 1 Open at 102.5, got ${pos.avgPrice} on bar ${pos.openBarIndex}`);
        }
        console.log('  ✓ [PASS] 10H.1 Default Next-Bar Open execution timing');
    }

    // ============================================================
    // 2. process_orders_on_close = true Execution Timing (Executes on Bar N Close)
    // ============================================================
    {
        const engine = new PineOrderEngine({
            initialCapital: 10_000,
            processOrdersOnClose: true,
            slippageTicks: 0,
            commissionValue: 0,
        });

        // Bar 0: Order created with processOrdersOnClose = true
        engine.entry('L_Close', 'long', 1);
        engine.processBar(0, { timestamp: candles[0].timestamp, open: 100, high: 105, low: 98, close: 104, volume: 1000 });

        const pos = engine.getPosition();
        if (pos.side !== 'long' || pos.openBarIndex !== 0) {
            throw new Error(`[10H.2 Failed] Expected immediate fill on Bar 0 close, got ${pos.side} on bar ${pos.openBarIndex}`);
        }
        console.log('  ✓ [PASS] 10H.2 process_orders_on_close = true execution timing');
    }

    // ============================================================
    // 3. Gap-Through Limit Order Execution (Price improvement)
    // ============================================================
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
        engine.processBar(0, candles[0]);

        // Place limit buy @ 95
        engine.order('LimitBuy', 'long', 1, 95);

        // Bar 1 Gaps Down: Open = 90 (gapped below limit 95)
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 90, high: 93, low: 88, close: 92, volume: 1000 });

        const pos = engine.getPosition();
        // Limit buy should fill at 90 (better price / open price), NOT 95
        if (pos.avgPrice !== 90) {
            throw new Error(`[10H.3 Failed] Gap limit fill expected price improvement at Open (90), got ${pos.avgPrice}`);
        }
        console.log('  ✓ [PASS] 10H.3 Gap-Through Limit Order price improvement');
    }

    // ============================================================
    // 4. Gap-Through Stop Order Execution (Slippage beyond stop)
    // ============================================================
    {
        const engine = new PineOrderEngine({ initialCapital: 10_000, slippageTicks: 0, commissionValue: 0 });
        engine.processBar(0, candles[0]);
        engine.entry('LongEntry', 'long', 1);
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1000 }); // filled @ 100

        // Place Stop Loss @ 95
        engine.exit('StopLoss', 'LongEntry', 1, undefined, undefined, undefined, 95);

        // Bar 2 Gaps Down: Open = 88 (gapped through stop 95)
        engine.processBar(2, { timestamp: candles[0].timestamp + 600_000, open: 88, high: 89, low: 85, close: 87, volume: 1000 });

        const trades = engine.getTrades();
        // Stop loss must fill at Open (88), NOT at the stop level 95 (gap slippage)
        if (trades.length !== 1 || trades[0].exitPrice !== 88) {
            throw new Error(`[10H.4 Failed] Gap stop fill expected at Open (88), got ${trades[0]?.exitPrice}`);
        }
        console.log('  ✓ [PASS] 10H.4 Gap-Through Stop Order execution');
    }

    console.log('\n🎉 ALL PART 10H EXECUTION TIMING & GAP FILL AUDITS PASSED!\n');
}

if (typeof require !== 'undefined' && require.main === module) {
    testExecutionTimingAudit();
}
