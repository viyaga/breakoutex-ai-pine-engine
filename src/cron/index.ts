// ================================================================
// Cron Scheduler — runs every minute, processes all active Pine bots
// Concurrency-limited pool per cycle for speed & stability
// ================================================================

import cron from 'node-cron';
import env from '../config/env';
import { fetchActivePineBots } from '../engine/config-fetcher';
import { runPineCycle, clearCycleCache } from '../engine/index';
import { startCycleLogging, endCycleLogging } from '../utils/cycle-logger';

export function startCronJob(): void {
    cron.schedule(env.cronSchedule, async () => {
        startCycleLogging();
        const cycleStart = Date.now();
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`[Cron] ▶ CYCLE START  ${new Date().toISOString()}`);
        console.log(`${'─'.repeat(60)}`);

        // Clear candle cache at start of every cycle
        clearCycleCache();

        let succeeded = 0;
        let failed    = 0;

        try {
            const bots = await fetchActivePineBots();
            if (!bots.length) {
                console.log('[Cron] No active Pine bots. Skipping cycle.');
                return;
            }
            console.log(`[Cron] Processing ${bots.length} bot(s) | concurrency=${env.concurrency}`);

            // Concurrency-limited execution pool
            const executing = new Set<Promise<any>>();
            for (const bot of bots) {
                const p = runPineCycle(bot)
                    .then(() => { succeeded++; })
                    .catch(err => {
                        failed++;
                        console.error(`[Cron] Bot ${bot.id} failed:`, err?.message ?? err);
                    });
                executing.add(p);
                p.finally(() => executing.delete(p));
                if (executing.size >= env.concurrency) await Promise.race(executing);
            }
            await Promise.all(executing);

        } catch (err) {
            console.error('[Cron] CRITICAL cycle error:', err);
        } finally {
            const ms = Date.now() - cycleStart;
            const memUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
            const memTotal = Math.round(process.memoryUsage().heapTotal / 1024 / 1024);
            console.log(`${'─'.repeat(60)}`);
            console.log(`[Cron] ■ CYCLE DONE  ✓${succeeded} ✗${failed}  ${ms}ms | Heap: ${memUsed}MB / ${memTotal}MB`);
            console.log(`${'─'.repeat(60)}\n`);
            endCycleLogging();
        }
    });

    console.log(`[Cron] Scheduled: "${env.cronSchedule}"`);
}
