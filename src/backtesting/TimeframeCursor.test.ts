import { Candle } from '../config/types';
import {
    MTFSeriesCache,
} from './MTFSeriesCache';
import {
    TimeframeCursor,
} from './TimeframeCursor';

function candles(
    count: number,
    start = 0
): Candle[] {
    const result: Candle[] = [];

    for (let i = 0; i < count; i++) {
        const timestamp =
            start +
            i * 5 * 60_000;

        result.push({
            timestamp,
            open: 100 + i,
            high: 101 + i,
            low: 99 + i,
            close: 100.5 + i,
            volume: 1000 + i,
        });
    }

    return result;
}

export function testTimeframeCursor(): void {
    const base =
        candles(100);

    const mtf =
        new MTFSeriesCache(
            base,
            '5m'
        );

    const htf =
        mtf.get('15m')!;

    const cursor =
        new TimeframeCursor(htf);

    /*
     * 3 x 5m candles = one 15m candle.
     */
    cursor.advance(0);

    if (
        cursor.getHTFIndex() !== 0
    ) {
        throw new Error(
            'Expected HTF index 0 at base index 0.'
        );
    }

    cursor.advance(1);

    if (
        cursor.getHTFIndex() !== 0
    ) {
        throw new Error(
            'Expected HTF index 0 at base index 1.'
        );
    }

    cursor.advance(2);

    if (
        cursor.getHTFIndex() !== 0
    ) {
        throw new Error(
            'Expected HTF index 0 at base index 2.'
        );
    }

    cursor.advance(3);

    if (
        cursor.getHTFIndex() !== 1
    ) {
        throw new Error(
            'Expected HTF index 1 at base index 3.'
        );
    }

    if (
        cursor.getPreviousHTFIndex() !== 0
    ) {
        throw new Error(
            'Expected previous HTF index 0.'
        );
    }

    if (
        cursor.open() !==
        htf.series.open[1]
    ) {
        throw new Error(
            'HTF open mismatch.'
        );
    }

    if (
        cursor.closeAt(1) !==
        htf.series.close[0]
    ) {
        throw new Error(
            'Historical HTF close mismatch.'
        );
    }

    if (
        !cursor.isFirstBaseBarOfHTF()
    ) {
        throw new Error(
            'Base index 3 should be first bar of HTF index 1.'
        );
    }

    console.log(
        '✅ TimeframeCursor test passed.'
    );
}

if (
    typeof require !== 'undefined' &&
    require.main === module
) {
    testTimeframeCursor();
}
