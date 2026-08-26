import {
    BacktestResult,
} from './types';

export function printBacktestSignals(
    result: BacktestResult
): void {

    const signals =
        result.signalDiagnostics ?? [];

    console.log(
        `\n=== SIGNAL DIAGNOSTICS ===`
    );

    console.log(
        `Strategy: ${result.strategyName}`
    );

    console.log(
        `Signals: ${signals.length}`
    );

    for (const signal of signals) {

        console.log(
            `[${new Date(
                signal.timestamp
            ).toISOString()}] ` +
            `${signal.action.toUpperCase()} ` +
            `close=${signal.close} ` +
            `tp=${signal.tp ?? '-'} ` +
            `sl=${signal.sl ?? '-'} ` +
            `comment=${signal.comment ?? '-'} ` +
            `score=${signal.score ?? '-'} ` +
            `source=${signal.source ?? '-'}`
        );
    }
}
