// ================================================================
// Cron Scheduler — runs every minute, processes all active Pine bots
// Concurrency-limited pool per cycle for speed & stability
// ================================================================

import cron from 'node-cron';
import env from '../config/env';
import { fetchActivePineBots } from '../engine/config-fetcher';
import { runPineCycle, clearCycleCache } from '../engine/index';
import { startCycleLogging, endCycleLogging, tradingCronLogger } from '../utils/cycle-logger';

export function startCronJob(): void {
    cron.schedule(env.cronSchedule, async () => {
        startCycleLogging();
        const cycleStart = Date.now();
        let succeeded = 0;
        let failed    = 0;
        let totalProcessed = 0;

        tradingCronLogger.info('='.repeat(80));
        tradingCronLogger.info('[TradingCron] ========== CYCLE START ==========');
        tradingCronLogger.info('='.repeat(80));

        // Clear candle cache at start of every cycle
        clearCycleCache();
        tradingCronLogger.debug('[TradingV2] Market data caches cleared');

        try {
            tradingCronLogger.info('[TradingCron] Fetching active trading configs...');
            const bots = await fetchActivePineBots();
            totalProcessed = bots.length;

            if (!bots.length) {
                tradingCronLogger.info('[TradingCron] No active Pine bots found. Skipping cycle.');
                return;
            }

            tradingCronLogger.info(`[TradingCron] Fetched ${bots.length} configs`);
            tradingCronLogger.info(`[TradingCron] Processing batch of ${bots.length} configs with CONCURRENCY=${env.concurrency}...`);

            // Concurrency-limited execution pool
            const executing = new Set<Promise<any>>();
            for (const bot of bots) {
                const botStart = Date.now();
                tradingCronLogger.info(`[TradingCron] Starting cycle for config: ${bot.id} (${bot.SYMBOL})`);

                const p = runPineCycle(bot)
                    .then(() => {
                        succeeded++;
                        const botDur = Date.now() - botStart;
                        tradingCronLogger.info(`[TradingCron] ✓ Config ${bot.id} (${bot.SYMBOL}) completed successfully (Duration: ${botDur}ms)`);
                    })
                    .catch(err => {
                        failed++;
                        const botDur = Date.now() - botStart;
                        tradingCronLogger.error(`[TradingCron] ✗ Config ${bot.id} (${bot.SYMBOL}) failed (Duration: ${botDur}ms):`, {
                            reason: err?.message ?? err
                        });
                    });

                executing.add(p);
                p.finally(() => executing.delete(p));
                if (executing.size >= env.concurrency) await Promise.race(executing);
            }
            await Promise.all(executing);

            tradingCronLogger.info(`[TradingCron] Batch summary: ${bots.length} configs, ${succeeded} succeeded, ${failed} failed`);
            tradingCronLogger.info(`[TradingCron] Total processed so far: ${totalProcessed}`);
            tradingCronLogger.info(`[TradingCron] All configs processed. Breaking loop.`);

        } catch (err: any) {
            tradingCronLogger.error('[TradingCron] CRITICAL ERROR occurred:', { error: err?.message ?? err });
        } finally {
            const duration = Date.now() - cycleStart;
            const memUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            const memTotal = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);

            tradingCronLogger.info('='.repeat(80));
            tradingCronLogger.info('[TradingCron] ========== CYCLE COMPLETE ==========');
            tradingCronLogger.info(`[TradingCron] Total Processed: ${totalProcessed}`);
            tradingCronLogger.info(`[TradingCron] Succeeded: ${succeeded} | Failed: ${failed}`);
            tradingCronLogger.info(`[TradingCron] Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s) | Heap: ${memUsed}MB / ${memTotal}MB`);
            tradingCronLogger.info('='.repeat(80));

            endCycleLogging();
        }
    });

    tradingCronLogger.info(`[CronScheduler] Trading cycle cron job scheduled: "${env.cronSchedule}"`);
    tradingCronLogger.info(`[CronScheduler] Next execution will be triggered based on the schedule.`);
}
