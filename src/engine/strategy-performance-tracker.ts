// ================================================================
// Strategy Performance Tracker & Cooldown Manager
//
// Tracks real-world trade outcomes per symbol and strategy.
// Enforces a 4-hour cooldown if a strategy suffers 2 consecutive
// stop-outs during turbulent regime transitions to prevent capital drawdowns.
// ================================================================

export interface StrategyTradeRecord {
    timestamp: number;
    outcome: 'win' | 'loss';
    pnl: number;
}

export interface StrategyPerformanceEntry {
    symbol: string;
    strategyId: string;
    totalTrades: number;
    wins: number;
    losses: number;
    consecutiveLosses: number;
    cooldownUntil: number;
    recentTrades: StrategyTradeRecord[];
}

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export class StrategyPerformanceTracker {
    private static performanceMap = new Map<string, StrategyPerformanceEntry>();

    private static getKey(symbol: string, strategyId: string): string {
        return `${symbol.toUpperCase().trim()}:${strategyId.toLowerCase().trim()}`;
    }

    /**
     * Record a closed trade outcome (TP or SL)
     */
    static recordTradeOutcome(
        symbol: string,
        strategyId: string,
        outcome: 'win' | 'loss',
        pnl: number = 0
    ): void {
        if (!symbol || !strategyId || strategyId === 'stand_aside') return;

        const key = this.getKey(symbol, strategyId);
        let entry = this.performanceMap.get(key);

        if (!entry) {
            entry = {
                symbol: symbol.toUpperCase().trim(),
                strategyId: strategyId.toLowerCase().trim(),
                totalTrades: 0,
                wins: 0,
                losses: 0,
                consecutiveLosses: 0,
                cooldownUntil: 0,
                recentTrades: [],
            };
            this.performanceMap.set(key, entry);
        }

        entry.totalTrades++;
        entry.recentTrades.push({
            timestamp: Date.now(),
            outcome,
            pnl,
        });

        // Keep last 20 trades in memory
        if (entry.recentTrades.length > 20) {
            entry.recentTrades.shift();
        }

        if (outcome === 'win') {
            entry.wins++;
            entry.consecutiveLosses = 0;
            console.log(`[PerformanceTracker] 🎯 Win recorded for ${symbol} [${strategyId}] (Consecutive losses reset to 0)`);
        } else {
            entry.losses++;
            entry.consecutiveLosses++;
            console.log(`[PerformanceTracker] ⚠️ Loss recorded for ${symbol} [${strategyId}] (Consecutive losses: ${entry.consecutiveLosses})`);

            // Cooldown Trigger: 2 consecutive losses -> 4 hour cooldown
            if (entry.consecutiveLosses >= 2) {
                entry.cooldownUntil = Date.now() + FOUR_HOURS_MS;
                const hours = FOUR_HOURS_MS / (60 * 60 * 1000);
                console.warn(
                    `[PerformanceTracker] ❄️ COOLDOWN ACTIVATED for ${symbol} [${strategyId}]: ` +
                    `${entry.consecutiveLosses} consecutive stop-outs. Strategy paused for ${hours} hours.`
                );
            }
        }
    }

    /**
     * Check if a strategy is currently on cooldown for a given symbol
     */
    static isStrategyInCooldown(
        symbol: string,
        strategyId: string
    ): { inCooldown: boolean; remainingMinutes?: number; reason?: string } {
        if (!symbol || !strategyId || strategyId === 'stand_aside') {
            return { inCooldown: false };
        }

        const key = this.getKey(symbol, strategyId);
        const entry = this.performanceMap.get(key);

        if (!entry || !entry.cooldownUntil) {
            return { inCooldown: false };
        }

        const now = Date.now();
        if (now < entry.cooldownUntil) {
            const remainingMinutes = Math.ceil((entry.cooldownUntil - now) / 60_000);
            return {
                inCooldown: true,
                remainingMinutes,
                reason: `2 consecutive stop-outs. In cooling-off period (${remainingMinutes}m remaining).`,
            };
        }

        // Cooldown has expired
        entry.cooldownUntil = 0;
        entry.consecutiveLosses = 0;
        return { inCooldown: false };
    }

    /**
     * Retrieve stats for a strategy
     */
    static getStrategyStats(symbol: string, strategyId: string): StrategyPerformanceEntry | undefined {
        return this.performanceMap.get(this.getKey(symbol, strategyId));
    }

    /**
     * Manually clear cooldown (e.g. on manual user restart)
     */
    static clearCooldown(symbol: string, strategyId: string): void {
        const key = this.getKey(symbol, strategyId);
        const entry = this.performanceMap.get(key);
        if (entry) {
            entry.cooldownUntil = 0;
            entry.consecutiveLosses = 0;
        }
    }
}
