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
const AI_LOG_DIR = path.join(LOG_DIR, 'ai');
const AI_EVALUATIONS_LOG = path.join(LOG_DIR, 'ai_evaluations.log');
const MAX_LOG_FILES = 20;
const MAX_HIGH_SCORE_LOG_FILES = 10;
const MAX_AI_DAILY_LOG_FILES = 30;
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
    if (!fs.existsSync(AI_LOG_DIR)) {
        fs.mkdirSync(AI_LOG_DIR, { recursive: true });
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

export interface AiInteractionLogData {
    botId?: string;
    symbol?: string;
    mode?: string;
    model?: string;
    systemPrompt?: string;
    userPrompt: string;
    rawResponse?: string;
    parsedResponse?: any;
    error?: string;
    durationMs?: number;
    regime?: string;
}

/**
 * Rotates daily AI evaluation log files to keep at most MAX_AI_DAILY_LOG_FILES (30).
 */
function rotateAiDailyLogs(): void {
    try {
        if (!fs.existsSync(AI_LOG_DIR)) return;
        const files = fs.readdirSync(AI_LOG_DIR).filter(f => f.startsWith('ai_eval_') && f.endsWith('.log'));
        if (files.length <= MAX_AI_DAILY_LOG_FILES) return;

        const sorted = files
            .map(f => {
                const p = path.join(AI_LOG_DIR, f);
                try {
                    return { name: f, path: p, time: fs.statSync(p).mtimeMs };
                } catch {
                    return null;
                }
            })
            .filter((x): x is { name: string; path: string; time: number } => x !== null)
            .sort((a, b) => a.time - b.time);

        const deleteCount = sorted.length - MAX_AI_DAILY_LOG_FILES;
        for (let i = 0; i < deleteCount; i++) {
            try {
                fs.unlinkSync(sorted[i].path);
            } catch {
                // ignore
            }
        }
    } catch {
        // ignore
    }
}

/**
 * Logs full AI input (system instruction & user prompt) and AI response to dedicated log files:
 * 1. logs/ai_evaluations.log (running stream)
 * 2. logs/ai/ai_eval_YYYYMMDD.log (daily archive)
 */
export function logAiInteractionToFile(data: AiInteractionLogData): void {
    try {
        ensureDirs();

        const now = new Date();
        const isoTime = now.toISOString();
        const dateStr = isoTime.substring(0, 10).replace(/-/g, ''); // YYYYMMDD
        const dailyFile = path.join(AI_LOG_DIR, `ai_eval_${dateStr}.log`);

        const botInfo = data.botId ? `Bot: ${data.botId}` : '';
        const symbolInfo = data.symbol ? `Symbol: ${data.symbol}` : '';
        const modeInfo = data.mode ? `Mode: ${data.mode}` : '';
        const modelInfo = data.model ? `Model: ${data.model}` : '';
        const durInfo = data.durationMs !== undefined ? `Duration: ${data.durationMs}ms` : '';
        const headerTags = [botInfo, symbolInfo, modeInfo, modelInfo, durInfo].filter(Boolean).join(' | ');

        const lines: string[] = [];
        lines.push('='.repeat(80));
        lines.push(`[AI Interaction] ${isoTime} ${headerTags ? `| ${headerTags}` : ''}`);
        lines.push('='.repeat(80));

        if (data.systemPrompt) {
            lines.push('--- [SYSTEM PROMPT] ---');
            lines.push(data.systemPrompt.trim());
        }

        lines.push('--- [AI INPUT (USER PROMPT)] ---');
        lines.push(data.userPrompt.trim());

        if (data.rawResponse) {
            lines.push('--- [AI RESPONSE (RAW)] ---');
            lines.push(data.rawResponse.trim());
        }

        if (data.parsedResponse) {
            lines.push('--- [AI PARSED DECISION] ---');
            lines.push(typeof data.parsedResponse === 'string' ? data.parsedResponse : JSON.stringify(data.parsedResponse, null, 2));
        }

        if (data.error) {
            lines.push('--- [AI ERROR / FALLBACK] ---');
            lines.push(data.error.trim());
        }

        lines.push('='.repeat(80));
        lines.push('\n');

        const block = lines.join('\n');

        // 1. Append to general AI evaluation log
        fs.appendFileSync(AI_EVALUATIONS_LOG, block, 'utf-8');

        // 2. Append to daily archive log
        fs.appendFileSync(dailyFile, block, 'utf-8');
        rotateAiDailyLogs();

        // 3. Also write clean summary to active cycle log if active
        writeToActiveLog(`[AI Log] Logged AI interaction for ${data.symbol || 'Bot'} to ${path.basename(AI_EVALUATIONS_LOG)} and ai/ai_eval_${dateStr}.log`);

    } catch (err) {
        if (originalError) {
            originalError('Failed to write AI interaction log to file:', err);
        } else {
            console.error('Failed to write AI interaction log to file:', err);
        }
    }
}

