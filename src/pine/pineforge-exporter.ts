// ================================================================
// BreakoutEx AI — PineForge C++ Strategy & Dataset Exporter
// Exports Strategy Library scripts as standard `.pine` files and
// historical multi-timeframe candles as CSV for the PineForge C++ Engine.
// ================================================================

import fs from 'fs';
import path from 'path';
import { Candle } from '../config/types';
import { getAllStrategies, PineStrategyDefinition } from './strategy-library';

export interface ExportOptions {
    outputDir?: string;
    exportKlinesCsv?: boolean;
}

/**
 * Export all 12 institutional Pine Script strategies to standalone .pine files
 */
export function exportStrategiesToPineFiles(outputDir = path.resolve(process.cwd(), 'pine-exports')): string[] {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const exportedPaths: string[] = [];
    const allStrats = getAllStrategies();

    for (const strat of allStrats) {
        const fileName = `${strat.id}.pine`;
        const filePath = path.join(outputDir, fileName);

        const content = [
            `// ================================================================`,
            `// Strategy: ${strat.name}`,
            `// ID: ${strat.id}`,
            `// Best Regimes: ${strat.bestMarketConditions.join(', ')}`,
            `// Timeframe: ${strat.recommendedTimeframe}`,
            `// Target TP: ${strat.defaultTpPercent}% | Target SL: ${strat.defaultSlPercent}%`,
            `// ================================================================`,
            ``,
            strat.pineScript.trim(),
            ``,
        ].join('\n');

        fs.writeFileSync(filePath, content, 'utf-8');
        exportedPaths.push(filePath);
    }

    return exportedPaths;
}

/**
 * Export candle map to PineForge-compatible CSV kline files
 * Format: timestamp,open,high,low,close,volume
 */
export function exportCandlesToCsv(
    symbol: string,
    candleMap: Map<string, Candle[]>,
    outputDir = path.resolve(process.cwd(), 'pine-exports/data')
): string[] {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const exportedPaths: string[] = [];

    for (const [tf, candles] of candleMap.entries()) {
        const fileName = `${symbol.toUpperCase()}_${tf}.csv`;
        const filePath = path.join(outputDir, fileName);

        const header = 'timestamp,open,high,low,close,volume\n';
        const rows = candles.map(c => `${c.timestamp},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join('\n');

        fs.writeFileSync(filePath, header + rows + '\n', 'utf-8');
        exportedPaths.push(filePath);
    }

    return exportedPaths;
}
