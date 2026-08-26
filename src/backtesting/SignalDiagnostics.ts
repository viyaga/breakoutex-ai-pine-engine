// ================================================================
// BreakoutEx AI — Signal Diagnostics
// ================================================================

import { Candle, PineSignal } from '../config/types';

export interface SignalDiagnostic {

    barIndex: number;

    timestamp: number;

    open: number;

    high: number;

    low: number;

    close: number;

    action: PineSignal['action'];

    tp?: number;

    sl?: number;

    comment?: string;

    score?: number;

    source?: PineSignal['source'];

    explicitScore?: boolean;
}

export function createSignalDiagnostic(
    barIndex: number,
    candle: Candle,
    signal: PineSignal
): SignalDiagnostic {

    return {

        barIndex,

        timestamp:
            candle.timestamp,

        open:
            candle.open,

        high:
            candle.high,

        low:
            candle.low,

        close:
            candle.close,

        action:
            signal.action,

        tp:
            signal.tp,

        sl:
            signal.sl,

        comment:
            signal.comment,

        score:
            signal.score,

        source:
            signal.source,

        explicitScore:
            signal.explicitScore,
    };
}
