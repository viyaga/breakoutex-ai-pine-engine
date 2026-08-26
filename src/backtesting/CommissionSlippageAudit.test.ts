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

export function testCommissionSlippageAudit(): void {
    console.log('Testing Part 10G — Commission, Slippage & Cost Model Audit...');

    const candles = generateCandles(10, 100);

    // ============================================================
    // 1. Zero Commission & Zero Slippage Baseline
    // ============================================================
    {
        const engine = new PineOrderEngine({
            initialCapital: 10_000,
            commissionValue: 0,
            slippageTicks: 0,
        });

        engine.processBar(0, candles[0]);
        engine.entry('L1', 'long', 1);
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1000 }); // entry @ 100

        engine.close('L1');
        engine.processBar(2, { timestamp: candles[0].timestamp + 600_000, open: 110, high: 111, low: 109, close: 110, volume: 1000 }); // exit @ 110

        const trades = engine.getTrades();
        if (trades.length !== 1 || trades[0].commission !== 0 || trades[0].slippage !== 0 || trades[0].netPnl !== 10) {
            throw new Error(`[10G.1 Failed] Zero friction baseline expected netPnl 10, got ${trades[0]?.netPnl}`);
        }
        console.log('  ✓ [PASS] 10G.1 Zero commission and zero slippage baseline');
    }

    // ============================================================
    // 2. Percentage Commission Model (0.1% taker)
    // ============================================================
    {
        const engine = new PineOrderEngine({
            initialCapital: 10_000,
            commissionType: 'percent',
            commissionValue: 0.1, // 0.1% on entry (100) + exit (110) = $0.10 + $0.11 = $0.21
            slippageTicks: 0,
        });

        engine.processBar(0, candles[0]);
        engine.entry('L1', 'long', 1);
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1000 });

        engine.close('L1');
        engine.processBar(2, { timestamp: candles[0].timestamp + 600_000, open: 110, high: 111, low: 109, close: 110, volume: 1000 });

        const trades = engine.getTrades();
        const expectedCommission = (100 * 1 + 110 * 1) * 0.001; // 0.21
        const expectedNetPnl = 10 - expectedCommission; // 9.79

        if (Math.abs(trades[0].commission - expectedCommission) > 1e-6 || Math.abs(trades[0].netPnl - expectedNetPnl) > 1e-6) {
            throw new Error(`[10G.2 Failed] Percent commission expected ${expectedCommission}, got ${trades[0]?.commission}`);
        }
        console.log('  ✓ [PASS] 10G.2 Percentage Commission Model');
    }

    // ============================================================
    // 3. Fixed Per Contract Commission Model ($1.50 per contract)
    // ============================================================
    {
        const engine = new PineOrderEngine({
            initialCapital: 10_000,
            commissionType: 'fixed_per_contract',
            commissionValue: 1.5, // $1.50 per contract per turn = $3.00 for round-trip per contract * 4 qty = $12.00
            slippageTicks: 0,
        });

        engine.processBar(0, candles[0]);
        engine.entry('L1', 'long', 4);
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1000 });

        engine.close('L1');
        engine.processBar(2, { timestamp: candles[0].timestamp + 600_000, open: 110, high: 111, low: 109, close: 110, volume: 1000 });

        const trades = engine.getTrades();
        const expectedCommission = 4 * 1.5 * 2; // 12.00
        const grossPnl = 4 * (110 - 100); // 40.00
        const expectedNetPnl = grossPnl - expectedCommission; // 28.00

        if (trades[0].commission !== expectedCommission || trades[0].netPnl !== expectedNetPnl) {
            throw new Error(`[10G.3 Failed] Fixed per contract commission expected ${expectedCommission}, got ${trades[0]?.commission}`);
        }
        console.log('  ✓ [PASS] 10G.3 Fixed Per Contract Commission Model');
    }

    // ============================================================
    // 4. Fixed Per Order Commission Model ($5 per order)
    // ============================================================
    {
        const engine = new PineOrderEngine({
            initialCapital: 10_000,
            commissionType: 'fixed_per_order',
            commissionValue: 5.0, // $5 entry order + $5 exit order = $10 total
            slippageTicks: 0,
        });

        engine.processBar(0, candles[0]);
        engine.entry('L1', 'long', 10);
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1000 });

        engine.close('L1');
        engine.processBar(2, { timestamp: candles[0].timestamp + 600_000, open: 110, high: 111, low: 109, close: 110, volume: 1000 });

        const trades = engine.getTrades();
        const expectedCommission = 10.0;
        const grossPnl = 10 * 10; // 100
        const expectedNetPnl = 90.0;

        if (trades[0].commission !== expectedCommission || trades[0].netPnl !== expectedNetPnl) {
            throw new Error(`[10G.4 Failed] Fixed per order commission expected ${expectedCommission}, got ${trades[0]?.commission}`);
        }
        console.log('  ✓ [PASS] 10G.4 Fixed Per Order Commission Model');
    }

    // ============================================================
    // 5. Slippage Friction Modeling (1 tick slippage = 0.5 price adverse)
    // ============================================================
    {
        const engine = new PineOrderEngine({
            initialCapital: 10_000,
            commissionValue: 0,
            slippageTicks: 1,
            tickSize: 0.5, // 1 tick = 0.5 points
        });

        engine.processBar(0, candles[0]);
        engine.entry('L1', 'long', 1);
        // Entry fills at open (100) + slippage (0.5) = 100.5
        engine.processBar(1, { timestamp: candles[0].timestamp + 300_000, open: 100, high: 101, low: 99, close: 100, volume: 1000 });

        engine.close('L1');
        // Exit fills at open (110) - slippage (0.5) = 109.5
        engine.processBar(2, { timestamp: candles[0].timestamp + 600_000, open: 110, high: 111, low: 109, close: 110, volume: 1000 });

        const trades = engine.getTrades();
        if (trades[0].entryPrice !== 100.5 || trades[0].exitPrice !== 109.5 || trades[0].netPnl !== 9.0) {
            throw new Error(`[10G.5 Failed] Slippage fill prices expected 100.5 and 109.5 (netPnl 9.0), got ${trades[0]?.entryPrice} -> ${trades[0]?.exitPrice} (pnl ${trades[0]?.netPnl})`);
        }
        console.log('  ✓ [PASS] 10G.5 Slippage friction adverse execution');
    }

    console.log('\n🎉 ALL PART 10G COMMISSION & SLIPPAGE COST MODEL AUDITS PASSED!\n');
}

if (typeof require !== 'undefined' && require.main === module) {
    testCommissionSlippageAudit();
}
