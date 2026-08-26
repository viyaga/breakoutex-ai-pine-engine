// ================================================================
// Manual trigger route — POST /api/pine/trigger
// Useful for testing a bot without waiting for the cron
// ================================================================

import { Router, Request, Response } from 'express';
import { runPineCycle, clearCycleCache } from '../engine/index';
import { fetchActivePineBots } from '../engine/config-fetcher';
import { evaluatePineScript } from '../interpreter';
import { Backtester, getAllStrategies, getStrategyById } from '../backtesting';
import { PineBotConfig } from '../config/types';
import env from '../config/env';

const router = Router();

/**
 * POST /api/pine/trigger
 * Body: { botId?: string }  — omit botId to trigger all bots
 */
router.post('/trigger', async (req: Request, res: Response) => {
    const { botId } = req.body as { botId?: string };
    const ts = new Date().toISOString();

    try {
        clearCycleCache();
        const allBots = await fetchActivePineBots();
        const bots    = botId ? allBots.filter(b => b.id === botId) : allBots;

        if (!bots.length) {
            return void res.status(404).json({ success: false, message: 'No matching active Pine bots found', ts });
        }

        // Run concurrently
        const results = await Promise.allSettled(bots.map(b => runPineCycle(b)));

        const summary = results.map((r, i) => ({
            botId:  bots[i].id,
            symbol: bots[i].SYMBOL,
            status: r.status,
            reason: r.status === 'rejected' ? String((r as any).reason) : undefined,
        }));

        return void res.json({ success: true, ts, triggered: bots.length, summary });
    } catch (err: any) {
        return void res.status(500).json({ success: false, message: err.message, ts });
    }
});

/**
 * POST /api/pine/evaluate
 * Body: { script: string, candles?: Candle[] }
 * Returns the signal without placing any orders — for testing scripts
 */
router.post('/evaluate', (req: Request, res: Response) => {
    const { script, candles } = req.body as { script: string; candles?: any[] };
    if (!script) return void res.status(400).json({ error: 'script is required' });

    const sampleCandles = candles ?? generateSampleCandles();
    try {
        const signal = evaluatePineScript(script, sampleCandles);
        return void res.json({ success: true, signal });
    } catch (err: any) {
        return void res.status(400).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/pine/backtest
 * Body: { strategyId?: string, timeframe?: string, windowBars?: number, candles?: Record<string, Candle[]> }
 */
router.post('/backtest', (req: Request, res: Response) => {
    const { strategyId, timeframe = '5m', windowBars = 500, candles } = req.body as {
        strategyId?: string;
        timeframe?: string;
        windowBars?: number;
        candles?: Record<string, any[]>;
    };

    const candleMap = new Map<string, any[]>();
    if (candles && typeof candles === 'object') {
        for (const [tf, list] of Object.entries(candles)) {
            candleMap.set(tf, list);
        }
    } else {
        candleMap.set(timeframe, generateSampleCandles());
    }

    try {
        if (strategyId) {
            const strat = getStrategyById(strategyId);
            if (!strat) {
                return void res.status(404).json({ success: false, error: `Strategy '${strategyId}' not found` });
            }
            const result = Backtester.run({
                strategy: strat,
                candleMap,
                options: { baseTimeframe: timeframe, windowBars },
            });
            return void res.json({ success: true, result });
        } else {
            const allStrats = getAllStrategies();
            const results = Backtester.runMany(
                allStrats,
                candleMap,
                { baseTimeframe: timeframe, windowBars }
            );
            return void res.json({ success: true, count: results.length, results });
        }
    } catch (err: any) {
        return void res.status(500).json({ success: false, error: err.message });
    }
});

/** Health check */
router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', ts: new Date().toISOString(), dryRun: env.dryRun });
});

/** Generate 100 sample candles for script testing */
function generateSampleCandles() {
    const candles = [];
    let price = 50_000;
    const now = Date.now();
    for (let i = 0; i < 100; i++) {
        const open  = price;
        const move  = (Math.random() - 0.48) * price * 0.005;
        const close = open + move;
        const high  = Math.max(open, close) * (1 + Math.random() * 0.003);
        const low   = Math.min(open, close) * (1 - Math.random() * 0.003);
        candles.push({ timestamp: now - (100 - i) * 300_000, open, high, low, close, volume: Math.random() * 100 });
        price = close;
    }
    return candles;
}

export default router;
