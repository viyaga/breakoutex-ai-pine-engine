import { Candle } from '../config/types';
import { STRATEGY_LIBRARY } from '../pine/strategy-library';
import { evaluatePineScript } from '../interpreter';
import { PineV6BacktestRunner } from '../../../breakoutex-ai-mobile/src/pine-engine/runner';
import { PineCandle } from '../../../breakoutex-ai-mobile/src/pine-engine/types';

async function fetchBinanceKlines(symbol: string, interval: string, limit = 500): Promise<Candle[]> {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = (await resp.json()) as any[][];
    return raw.map(d => ({
        timestamp: Number(d[0]),
        open: Number(d[1]),
        high: Number(d[2]),
        low: Number(d[3]),
        close: Number(d[4]),
        volume: Number(d[5]),
    }));
}

interface StrategyAuditResult {
    strategyName: string;
    totalBars: number;
    backendSignals: number;
    mobileSignals: number;
    signalParityPercent: string;
    firstMismatch: string;
    verdict: 'IDENTICAL PARITY ✔' | 'EXECUTION-ALIGNED 🟢' | 'MISMATCH ❌' | 'UNPROVEN ⚠️';
}

async function runRigorousParityAudit() {
    console.log(`===================================================================================================`);
    console.log(`🔬 RIGOROUS CANDLE-BY-CANDLE SIGNAL & MTF PARITY AUDIT (1,000 BARS @ 5M + 15M + 1H + 4H)`);
    console.log(`Backend Engine (AST Evaluation) vs Mobile Engine (PineV6 Execution Engine)`);
    console.log(`===================================================================================================\n`);

    const symbol = 'ETHUSDT';
    console.log(`Fetching Binance Futures live multi-timeframe dataset for ${symbol}...`);
    const candles5m = await fetchBinanceKlines(symbol, '5m', 1000);
    const candles15m = await fetchBinanceKlines(symbol, '15m', 800);
    const candles1h = await fetchBinanceKlines(symbol, '1h', 500);
    const candles4h = await fetchBinanceKlines(symbol, '4h', 300);

    const mobileCandles5m: PineCandle[] = candles5m.map(c => ({
        time: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));

    const htfCandlesMap: Record<string, PineCandle[]> = {
        '15': candles15m.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        '15m': candles15m.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        '60': candles1h.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        '1h': candles1h.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        '240': candles4h.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
        '4h': candles4h.map(c => ({ time: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
    };

    const strategiesToTest = [
        'mtf_donchian_breakout',
        'volatility_squeeze',
        'supertrend_vwap_momentum',
        'failed_breakout_trap',
        'bollinger_mean_reversion',
        'atr_range_expansion',
        'ema_trend_continuation',
    ];

    const results: StrategyAuditResult[] = [];

    for (const stratKey of strategiesToTest) {
        const strat = STRATEGY_LIBRARY[stratKey];
        if (!strat) continue;

        // Run Mobile Engine with debug capture
        const mobileRunner = new PineV6BacktestRunner();
        const mobileRes = await mobileRunner.execute(strat.pineScript, mobileCandles5m, {
            symbol: 'ETHUSDT',
            baseTimeframe: '5',
            initialCapital: 10000,
            leverage: 1,
            commissionPercent: 0.04,
            slippageTicks: 1,
            tickSize: 0.1,
            pyramiding: 10, // Allow all entries to be recorded for true signal comparison
            htfCandlesMap,
        });

        const mobileEntryBars = new Set<number>();
        mobileRes.debugLogs?.forEach(log => {
            if (log.startsWith('[PINE ENTRY]')) {
                // e.g. bar: 72
                const match = log.match(/bar:\s*(\d+)/);
                if (match) mobileEntryBars.add(Number(match[1]));
            }
        });

        // If debugLogs didn't capture, look at trade entries
        mobileRes.metrics.trades.forEach(t => mobileEntryBars.add(t.entryBarIndex));

        // Scan every bar from warmup (50) to 1000
        let matches = 0;
        let totalEvaluated = 0;
        let bSignalCount = 0;
        let mSignalCount = 0;
        let firstMismatch = 'None (100% Match)';

        for (let bar = 50; bar < candles5m.length; bar++) {
            totalEvaluated++;
            const slice5m = candles5m.slice(0, bar + 1);
            const cutoff = candles5m[bar].timestamp;

            const sliceMap = new Map<string, Candle[]>();
            sliceMap.set('5m', slice5m);
            sliceMap.set('15m', candles15m.filter(c => c.timestamp <= cutoff));
            sliceMap.set('1h', candles1h.filter(c => c.timestamp <= cutoff));
            sliceMap.set('4h', candles4h.filter(c => c.timestamp <= cutoff));

            const bSig = evaluatePineScript(strat.pineScript, sliceMap, '5m');
            const bTriggered = bSig.action === 'buy' || bSig.action === 'sell';
            const mTriggered = mobileEntryBars.has(bar);

            if (bTriggered) bSignalCount++;
            if (mTriggered) mSignalCount++;

            if (bTriggered === mTriggered) {
                matches++;
            } else if (firstMismatch === 'None (100% Match)') {
                firstMismatch = `Bar #${bar} @ ${new Date(candles5m[bar].timestamp).toISOString()} (Backend=${bTriggered ? bSig.action.toUpperCase() : 'NONE'}, Mobile=${mTriggered ? 'BUY' : 'NONE'})`;
            }
        }

        const matchPct = ((matches / totalEvaluated) * 100).toFixed(2);
        let verdict: StrategyAuditResult['verdict'] = 'MISMATCH ❌';

        if (bSignalCount === 0 && mSignalCount === 0) {
            verdict = 'UNPROVEN ⚠️';
        } else if (bSignalCount === mSignalCount && firstMismatch === 'None (100% Match)') {
            verdict = 'IDENTICAL PARITY ✔';
        } else if (Math.abs(bSignalCount - mSignalCount) <= 1 && parseFloat(matchPct) >= 99.8) {
            verdict = 'EXECUTION-ALIGNED 🟢';
        }

        results.push({
            strategyName: strat.name,
            totalBars: totalEvaluated,
            backendSignals: bSignalCount,
            mobileSignals: mSignalCount,
            signalParityPercent: `${matchPct}%`,
            firstMismatch,
            verdict,
        });
    }

    console.log(`\n========================================================================================================================`);
    console.log(`Strategy Name                  | Backend Signals | Mobile Signals | Signal Parity | Verdict`);
    console.log(`------------------------------------------------------------------------------------------------------------------------`);
    for (const r of results) {
        console.log(
            `${r.strategyName.padEnd(30)} | ${String(r.backendSignals).padStart(15)} | ${String(r.mobileSignals).padStart(14)} | ${r.signalParityPercent.padStart(13)} | ${r.verdict}`
        );
        if (r.firstMismatch !== 'None (100% Match)') {
            console.log(`   ↳ First Divergence: ${r.firstMismatch}`);
        }
    }
    console.log(`========================================================================================================================\n`);
}

runRigorousParityAudit().catch(console.error);
