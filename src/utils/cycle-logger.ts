// ================================================================
// Comprehensive Cycle Logger & High-Score Logger Utility
// Matches BreakoutEx Bot Engine architecture:
// 1. Logs each full cron cycle to logs/cycle_YYYYMMDD_HHmmss.log (max 20)
// 2. Automatically promotes high-scoring executions to logs/high_scores/ (max 10)
// 3. Captures all console logs, warnings, and errors seamlessly
// ================================================================

import fs from 'fs';
import path from 'path';
import util from 'util';

const LOG_DIR = path.join(process.cwd(), 'logs');
const HIGH_SCORE_LOG_DIR = path.join(LOG_DIR, 'high_scores');
const MAX_LOG_FILES = 20;
const MAX_HIGH_SCORE_LOG_FILES = 10;
const FILE_PATTERN = /^cycle_\d{8}_\d{6}\.log$/; // matches cycle_YYYYMMDD_HHmmss.log

let activeLogFile: string | null = null;
let originalLog: typeof console.log | null = null;
let originalError: typeof console.error | null = null;
let originalWarn: typeof console.warn | null = null;

/** Ensure log directories exist */
function ensureDirs(): void {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    if (!fs.existsSync(HIGH_SCORE_LOG_DIR)) {
        fs.mkdirSync(HIGH_SCORE_LOG_DIR, { recursive: true });
    }
}

/**
 * Starts global cycle logging by creating a log file for the current cycle and intercepting console output.
 */
export function startCycleLogging(): void {
    try {
        ensureDirs();
        rotateLogs();

        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        const hours = String(now.getUTCHours()).padStart(2, '0');
        const minutes = String(now.getUTCMinutes()).padStart(2, '0');
        const seconds = String(now.getUTCSeconds()).padStart(2, '0');

        const dateStr = `${year}${month}${day}_${hours}${minutes}${seconds}`;
        activeLogFile = path.join(LOG_DIR, `cycle_${dateStr}.log`);

        if (!originalLog) {
            originalLog = console.log;
            originalError = console.error;
            originalWarn = console.warn;

            console.log = (...args: any[]) => {
                originalLog!(...args);
                writeToActiveLog(util.format(...args));
            };

            console.error = (...args: any[]) => {
                originalError!(...args);
                writeToActiveLog(util.format(...args));
            };

            console.warn = (...args: any[]) => {
                originalWarn!(...args);
                writeToActiveLog(util.format(...args));
            };
        }
    } catch (err) {
        if (originalError) {
            originalError('Failed to start cycle logging:', err);
        } else {
            console.error('Failed to start cycle logging:', err);
        }
    }
}

/**
 * Returns the path of the currently active cycle log file (if active).
 */
export function getActiveLogFile(): string | null {
    return activeLogFile;
}

/**
 * Ends cycle logging by resetting the active file and restoring original console functions.
 */
export function endCycleLogging(): void {
    activeLogFile = null;
    if (originalLog) {
        console.log = originalLog;
        console.error = originalError!;
        console.warn = originalWarn!;
        originalLog = null;
        originalError = null;
        originalWarn = null;
    }
}

/**
 * Appends text content to the active log file, ensuring no ANSI colors are written.
 */
function writeToActiveLog(text: string): void {
    if (activeLogFile) {
        try {
            const cleanText = text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
            fs.appendFileSync(activeLogFile, cleanText + '\n');
        } catch (err) {
            if (originalError) {
                originalError('Failed to write to cycle log:', err);
            }
        }
    }
}

/**
 * Rotates log files in HIGH_SCORE_LOG_DIR to retain at most MAX_HIGH_SCORE_LOG_FILES (10).
 */
export function rotateHighScoreLogs(): void {
    try {
        if (!fs.existsSync(HIGH_SCORE_LOG_DIR)) return;

        const files = fs.readdirSync(HIGH_SCORE_LOG_DIR);
        const logFiles = files
            .map(f => {
                const filePath = path.join(HIGH_SCORE_LOG_DIR, f);
                let time = 0;
                try {
                    const stat = fs.statSync(filePath);
                    if (!stat.isFile()) return null;
                    time = stat.mtimeMs;
                } catch {
                    return null;
                }
                return { name: f, path: filePath, time };
            })
            .filter((item): item is { name: string; path: string; time: number } => item !== null)
            .sort((a, b) => a.time - b.time); // Oldest first

        if (logFiles.length > MAX_HIGH_SCORE_LOG_FILES) {
            const deleteCount = logFiles.length - MAX_HIGH_SCORE_LOG_FILES;
            for (let i = 0; i < deleteCount; i++) {
                try {
                    fs.unlinkSync(logFiles[i].path);
                } catch (unlinkErr) {
                    if (originalError) {
                        originalError(`Failed to delete old high score log file ${logFiles[i].name}:`, unlinkErr);
                    }
                }
            }
        }
    } catch (err) {
        if (originalError) {
            originalError('Error rotating high score logs:', err);
        }
    }
}

/**
 * Copies the current active normal cycle log file into the high score logs directory.
 */
export function promoteCurrentCycleToHighScore(details?: { symbol?: string; score?: number }): string | null {
    try {
        if (!activeLogFile || !fs.existsSync(activeLogFile)) {
            return null;
        }

        ensureDirs();

        const basename = path.basename(activeLogFile, '.log');
        const symbolTag = details?.symbol ? `_${details.symbol.replace(/[^a-zA-Z0-9]/g, '')}` : '';
        const scoreTag = details?.score !== undefined ? `_score${Math.round(details.score)}` : '';

        const destFileName = `high_score_${basename}${symbolTag}${scoreTag}.log`;
        const destPath = path.join(HIGH_SCORE_LOG_DIR, destFileName);

        fs.copyFileSync(activeLogFile, destPath);
        rotateHighScoreLogs();

        return destPath;
    } catch (err) {
        if (originalError) {
            originalError('Failed to promote cycle log to high score directory:', err);
        }
        return null;
    }
}

/**
 * Retains only the most recent (MAX_LOG_FILES - 1) log files in logs/.
 */
function rotateLogs(): void {
    try {
        if (!fs.existsSync(LOG_DIR)) return;
        const files = fs.readdirSync(LOG_DIR);
        const logFiles = files
            .filter(f => FILE_PATTERN.test(f))
            .map(f => {
                const filePath = path.join(LOG_DIR, f);
                let time = 0;
                try {
                    time = fs.statSync(filePath).mtimeMs;
                } catch {
                    const match = f.match(/cycle_(\d{8})_(\d{6})\.log/);
                    if (match) {
                        const dateStr = match[1];
                        const timeStr = match[2];
                        const year = parseInt(dateStr.substring(0, 4), 10);
                        const month = parseInt(dateStr.substring(4, 6), 10) - 1;
                        const day = parseInt(dateStr.substring(6, 8), 10);
                        const hour = parseInt(timeStr.substring(0, 2), 10);
                        const min = parseInt(timeStr.substring(2, 4), 10);
                        const sec = parseInt(timeStr.substring(4, 6), 10);
                        time = Date.UTC(year, month, day, hour, min, sec);
                    }
                }
                return { name: f, path: filePath, time };
            })
            .sort((a, b) => a.time - b.time); // Oldest first

        const keepCount = MAX_LOG_FILES - 1;
        if (logFiles.length > keepCount) {
            const deleteCount = logFiles.length - keepCount;
            for (let i = 0; i < deleteCount; i++) {
                try {
                    fs.unlinkSync(logFiles[i].path);
                } catch (unlinkErr) {
                    if (originalError) {
                        originalError(`Failed to delete old log file ${logFiles[i].name}:`, unlinkErr);
                    }
                }
            }
        }
    } catch (err) {
        if (originalError) {
            originalError('Error rotating logs:', err);
        } else {
            console.error('Error rotating logs:', err);
        }
    }
}

/**
 * Per-bot cycle log aggregator and trace logger
 */
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

    logAiInteraction(data: {
        model?: string;
        systemPrompt?: string;
        userPrompt: string;
        rawResponse?: string;
        parsedResponse?: any;
        error?: string;
        durationMs?: number;
    }): void {
        this.log(`\n${'='.repeat(70)}`);
        this.log(`[PineEngine][${this.botId}] 🤖 AI MARKET EVALUATION (${this.symbol}) | Model: ${data.model || 'Gemini'} | Duration: ${data.durationMs ?? 0}ms`);
        this.log('='.repeat(70));

        if (data.systemPrompt) {
            this.log(`--- [SYSTEM PROMPT] ---\n${data.systemPrompt.trim()}`);
        }

        this.log(`--- [AI INPUT (USER PROMPT)] ---\n${data.userPrompt.trim()}`);

        if (data.rawResponse) {
            this.log(`--- [AI RESPONSE (RAW)] ---\n${data.rawResponse.trim()}`);
        }

        if (data.parsedResponse) {
            const parsedStr = typeof data.parsedResponse === 'string' ? data.parsedResponse : JSON.stringify(data.parsedResponse, null, 2);
            this.log(`--- [AI PARSED DECISION] ---\n${parsedStr}`);
        }

        if (data.error) {
            this.warn(`--- [AI ERROR] ---\n${data.error.trim()}`);
        }

        this.log(`${'='.repeat(70)}\n`);
    }

    logBackendRequest(opts: { method: string; endpoint: string; url?: string; data?: any }): void {
        const payloadStr = opts.data !== undefined ? ` | Payload: ${typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data)}` : '';
        const msg = `[Payload API] ➔ Request: ${opts.method.toUpperCase()} ${opts.endpoint}${opts.url ? ` (${opts.url})` : ''}${payloadStr}`;
        this.log(`[PineEngine][${this.botId}] ${msg}`);
    }

    logBackendResponse(opts: { method: string; endpoint: string; status: number | string; data?: any; durationMs?: number }): void {
        const durStr = opts.durationMs !== undefined ? ` (${opts.durationMs}ms)` : '';
        const dataStr = opts.data !== undefined ? ` | Response: ${typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data)}` : '';
        const msg = `[Payload API] ⬅ Response: ${opts.method.toUpperCase()} ${opts.endpoint} | Status: ${opts.status}${durStr}${dataStr}`;
        this.log(`[PineEngine][${this.botId}] ${msg}`);
    }

    logBackendError(opts: { method: string; endpoint: string; error: any; durationMs?: number }): void {
        const durStr = opts.durationMs !== undefined ? ` (${opts.durationMs}ms)` : '';
        const errStr = opts.error?.message || (typeof opts.error === 'string' ? opts.error : JSON.stringify(opts.error));
        const msg = `[Payload API] ⬅ Error: ${opts.method.toUpperCase()} ${opts.endpoint} | Status: FAILED${durStr} | Error: ${errStr}`;
        this.error(`[PineEngine][${this.botId}] ${msg}`);
    }

    logExchangeRequest(opts: { exchange: string; action: string; method?: string; endpoint?: string; data?: any; details?: string }): void {
        const actionStr = opts.endpoint ? `${opts.method || 'GET'} ${opts.endpoint}` : opts.action;
        const detailStr = opts.details ? ` | ${opts.details}` : '';
        const dataStr = opts.data !== undefined ? ` | Data: ${typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data)}` : '';
        const msg = `[Exchange API (${opts.exchange})] ➔ Request: ${actionStr}${detailStr}${dataStr}`;
        this.log(`[PineEngine][${this.botId}] ${msg}`);
    }

    logExchangeResponse(opts: { exchange: string; action: string; method?: string; endpoint?: string; status: number | string; data?: any; durationMs?: number; details?: string }): void {
        const actionStr = opts.endpoint ? `${opts.method || 'GET'} ${opts.endpoint}` : opts.action;
        const durStr = opts.durationMs !== undefined ? ` (${opts.durationMs}ms)` : '';
        const detailStr = opts.details ? ` | ${opts.details}` : '';
        const dataStr = opts.data !== undefined ? ` | Response: ${typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data)}` : '';
        const msg = `[Exchange API (${opts.exchange})] ⬅ Response: ${actionStr} | Status: ${opts.status}${durStr}${detailStr}${dataStr}`;
        this.log(`[PineEngine][${this.botId}] ${msg}`);
    }

    logExchangeError(opts: { exchange: string; action: string; method?: string; endpoint?: string; error: any; status?: number | string; durationMs?: number }): void {
        const actionStr = opts.endpoint ? `${opts.method || 'GET'} ${opts.endpoint}` : opts.action;
        const durStr = opts.durationMs !== undefined ? ` (${opts.durationMs}ms)` : '';
        const statusStr = opts.status !== undefined ? ` | Status: ${opts.status}` : '';
        const errStr = opts.error?.message || (typeof opts.error === 'string' ? opts.error : JSON.stringify(opts.error));
        const msg = `[Exchange API (${opts.exchange})] ⬅ Error: ${actionStr}${statusStr}${durStr} | Error: ${errStr}`;
        this.error(`[PineEngine][${this.botId}] ${msg}`);
    }

    async finalize(finalScore?: number): Promise<void> {
        const duration = Date.now() - this.startTime;
        if (finalScore !== undefined) {
            this.setScore(finalScore);
        }

        const scoreText = this.score !== undefined ? `Score=${this.score}` : 'Score=N/A';
        this.addLog(`=== [PineEngine] BOT CYCLE END: ${this.symbol} (${duration}ms) | ${scoreText} ===\n`);

        // If score was high (>= 60), promote the active cycle log to high_scores
        if (this.score !== undefined && this.score >= 60) {
            promoteCurrentCycleToHighScore({ symbol: this.symbol, score: this.score });
        }
    }
}

/** Global standalone logging for Backend / Payload API interactions */
export function logBackendRequest(opts: { method: string; endpoint: string; url?: string; data?: any; botId?: string }): void {
    const botPrefix = opts.botId ? `[PineEngine][${opts.botId}] ` : '';
    const payloadStr = opts.data !== undefined ? ` | Payload: ${typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data)}` : '';
    console.log(`${botPrefix}[Payload API] ➔ Request: ${opts.method.toUpperCase()} ${opts.endpoint}${opts.url ? ` (${opts.url})` : ''}${payloadStr}`);
}

export function logBackendResponse(opts: { method: string; endpoint: string; status: number | string; data?: any; durationMs?: number; botId?: string }): void {
    const botPrefix = opts.botId ? `[PineEngine][${opts.botId}] ` : '';
    const durStr = opts.durationMs !== undefined ? ` (${opts.durationMs}ms)` : '';
    const dataStr = opts.data !== undefined ? ` | Response: ${typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data)}` : '';
    console.log(`${botPrefix}[Payload API] ⬅ Response: ${opts.method.toUpperCase()} ${opts.endpoint} | Status: ${opts.status}${durStr}${dataStr}`);
}

export function logBackendError(opts: { method: string; endpoint: string; error: any; durationMs?: number; botId?: string }): void {
    const botPrefix = opts.botId ? `[PineEngine][${opts.botId}] ` : '';
    const durStr = opts.durationMs !== undefined ? ` (${opts.durationMs}ms)` : '';
    const errStr = opts.error?.message || (typeof opts.error === 'string' ? opts.error : JSON.stringify(opts.error));
    console.error(`${botPrefix}[Payload API] ⬅ Error: ${opts.method.toUpperCase()} ${opts.endpoint} | Status: FAILED${durStr} | Error: ${errStr}`);
}

/** Global standalone logging for Exchange API interactions */
export function logExchangeRequest(opts: { exchange: string; action: string; method?: string; endpoint?: string; data?: any; details?: string; botId?: string }): void {
    const botPrefix = opts.botId ? `[PineEngine][${opts.botId}] ` : '';
    const actionStr = opts.endpoint ? `${opts.method || 'GET'} ${opts.endpoint}` : opts.action;
    const detailStr = opts.details ? ` | ${opts.details}` : '';
    const dataStr = opts.data !== undefined ? ` | Data: ${typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data)}` : '';
    console.log(`${botPrefix}[Exchange API (${opts.exchange})] ➔ Request: ${actionStr}${detailStr}${dataStr}`);
}

export function logExchangeResponse(opts: { exchange: string; action: string; method?: string; endpoint?: string; status: number | string; data?: any; durationMs?: number; details?: string; botId?: string }): void {
    const botPrefix = opts.botId ? `[PineEngine][${opts.botId}] ` : '';
    const actionStr = opts.endpoint ? `${opts.method || 'GET'} ${opts.endpoint}` : opts.action;
    const durStr = opts.durationMs !== undefined ? ` (${opts.durationMs}ms)` : '';
    const detailStr = opts.details ? ` | ${opts.details}` : '';
    const dataStr = opts.data !== undefined ? ` | Response: ${typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data)}` : '';
    console.log(`${botPrefix}[Exchange API (${opts.exchange})] ⬅ Response: ${actionStr} | Status: ${opts.status}${durStr}${detailStr}${dataStr}`);
}

export function logExchangeError(opts: { exchange: string; action: string; method?: string; endpoint?: string; error: any; status?: number | string; durationMs?: number; botId?: string }): void {
    const botPrefix = opts.botId ? `[PineEngine][${opts.botId}] ` : '';
    const actionStr = opts.endpoint ? `${opts.method || 'GET'} ${opts.endpoint}` : opts.action;
    const durStr = opts.durationMs !== undefined ? ` (${opts.durationMs}ms)` : '';
    const statusStr = opts.status !== undefined ? ` | Status: ${opts.status}` : '';
    const errStr = opts.error?.message || (typeof opts.error === 'string' ? opts.error : JSON.stringify(opts.error));
    console.error(`${botPrefix}[Exchange API (${opts.exchange})] ⬅ Error: ${actionStr}${statusStr}${durStr} | Error: ${errStr}`);
}


