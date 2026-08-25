// ================================================================
// Bot Cycle Logger & Auto-Rotation Utility
// Stores complete lifecycle execution logs in log/general (max 20)
// and high scoring signal executions in log/high_score (max 10)
// ================================================================

import fs from 'fs';
import path from 'path';

const LOG_ROOT = path.resolve(process.cwd(), 'log');
const GENERAL_LOG_DIR = path.join(LOG_ROOT, 'general');
const HIGH_SCORE_LOG_DIR = path.join(LOG_ROOT, 'high_score');

const MAX_GENERAL_FILES = 20;
const MAX_HIGH_SCORE_FILES = 10;

/** Ensure log directories exist */
function ensureDirs(): void {
    if (!fs.existsSync(GENERAL_LOG_DIR)) {
        fs.mkdirSync(GENERAL_LOG_DIR, { recursive: true });
    }
    if (!fs.existsSync(HIGH_SCORE_LOG_DIR)) {
        fs.mkdirSync(HIGH_SCORE_LOG_DIR, { recursive: true });
    }
}

/** Keep only the newest maxFiles in a directory */
function rotateFiles(dir: string, maxFiles: number): void {
    try {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir)
            .map(name => {
                const fullPath = path.join(dir, name);
                const stat = fs.statSync(fullPath);
                return { name, fullPath, mtime: stat.mtimeMs };
            })
            .filter(f => !fs.statSync(f.fullPath).isDirectory())
            .sort((a, b) => b.mtime - a.mtime); // newest first

        if (files.length > maxFiles) {
            const toDelete = files.slice(maxFiles);
            for (const f of toDelete) {
                try {
                    fs.unlinkSync(f.fullPath);
                } catch {
                    // Ignore deletion failure
                }
            }
        }
    } catch (err: any) {
        console.warn(`[CycleLogger] File rotation warning in ${dir}:`, err?.message ?? err);
    }
}

export class BotCycleLogger {
    private logs: string[] = [];
    private startTime: number = Date.now();
    public score?: number;

    constructor(
        public readonly botId: string,
        public readonly symbol: string
    ) {
        this.addLog(`=== [PineEngine] BOT CYCLE START: ${symbol} (Bot ID: ${botId}) ===`);
    }

    addLog(msg: string): void {
        const timeStr = new Date().toISOString();
        this.logs.push(`[${timeStr}] ${msg}`);
    }

    log(msg: string): void {
        this.addLog(msg);
        console.log(msg);
    }

    warn(msg: string): void {
        this.addLog(`[WARN] ${msg}`);
        console.warn(msg);
    }

    error(msg: string): void {
        this.addLog(`[ERROR] ${msg}`);
        console.error(msg);
    }

    setScore(score?: number): void {
        if (score !== undefined && !isNaN(score)) {
            this.score = score;
        }
    }

    async finalize(finalScore?: number): Promise<void> {
        const duration = Date.now() - this.startTime;
        if (finalScore !== undefined) {
            this.setScore(finalScore);
        }

        const scoreText = this.score !== undefined ? `Score=${this.score}` : 'Score=N/A';
        this.addLog(`=== [PineEngine] BOT CYCLE END: ${this.symbol} (${duration}ms) | ${scoreText} ===\n`);

        const fileContent = this.logs.join('\n');
        const nowIso = new Date().toISOString().replace(/[:.]/g, '-');
        const scorePrefix = this.score !== undefined ? `_score${Math.round(this.score)}` : '';
        const fileName = `${nowIso}_${this.symbol}_${this.botId}${scorePrefix}.log`;

        try {
            ensureDirs();

            // 1. Write to log/general (max 20 files)
            const generalPath = path.join(GENERAL_LOG_DIR, fileName);
            fs.writeFileSync(generalPath, fileContent, 'utf-8');
            rotateFiles(GENERAL_LOG_DIR, MAX_GENERAL_FILES);

            // 2. If score was more than 60, also write to log/high_score (max 10 files)
            if (this.score !== undefined && this.score > 60) {
                const highScorePath = path.join(HIGH_SCORE_LOG_DIR, fileName);
                fs.writeFileSync(highScorePath, fileContent, 'utf-8');
                rotateFiles(HIGH_SCORE_LOG_DIR, MAX_HIGH_SCORE_FILES);
            }
        } catch (err: any) {
            console.warn(`[CycleLogger] Failed to write cycle log:`, err?.message ?? err);
        }
    }
}
