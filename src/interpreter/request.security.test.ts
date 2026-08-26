import { Candle } from '../config/types';
import {
    MTFSeriesCache,
} from '../backtesting/MTFSeriesCache';
import {
    evaluatePineScript,
} from './interpreter';

function generateCandles(
    count: number
): Candle[] {
    const result: Candle[] = [];

    const start =
        Date.UTC(
            2026,
            0,
            1,
            10,
            0,
            0
        );

    for (
        let i = 0;
        i < count;
        i++
    ) {
        const close =
            100 + i;

        result.push({
            timestamp:
                start +
                i * 5 * 60_000,

            open:
                close - 0.5,

            high:
                close + 1,

            low:
                close - 1,

            close,

            volume:
                1000 + i,
        });
    }

    return result;
}

export function testSecurityMapping(): void {
    const candles =
        generateCandles(30);

    const cache =
        new MTFSeriesCache(
            candles,
            '5m'
        );

    const htf =
        cache.get('15m')!;

    if (
        htf.bars.length !== 10
    ) {
        throw new Error(
            `Expected 10 HTF bars, got ${htf.bars.length}`
        );
    }

    /*
     * First 15m candle:
     *
     * base 0 (10:00)
     * base 1 (10:05)
     * base 2 (10:10)
     */

    if (
        htf.bars[0].open !==
        candles[0].open
    ) {
        throw new Error(
            'HTF open mismatch.'
        );
    }

    if (
        htf.bars[0].close !==
        candles[2].close
    ) {
        throw new Error(
            'HTF close mismatch.'
        );
    }

    /*
     * The second HTF candle contains:
     *
     * base 3
     * base 4
     * base 5
     */

    if (
        cache.getHTFIndex(
            '15m',
            4
        ) !== 1
    ) {
        throw new Error(
            'Base → HTF mapping mismatch.'
        );
    }

    /*
     * Standard lookahead_off must not expose
     * an incomplete future HTF result.
     */
    const mapped =
        cache.getMappedHTFIndex(
            '15m',
            4,
            {
                lookahead: 'off',
                gaps: 'gaps_off',
            }
        );

    if (
        mapped !== 0
    ) {
        throw new Error(
            `Expected previous confirmed HTF index 0, got ${mapped}`
        );
    }

    // ------------------------------------------------------------
    // Test No Future Leakage in Pine evaluation
    // ------------------------------------------------------------
    const candleMap = new Map<string, Candle[]>();
    candleMap.set('5m', candles);
    candleMap.set('15m', htf.candles as Candle[]);

    const script = `
        htf_c = request.security(syminfo.tickerid, "15m", close)
        if htf_c > 0
            strategy.entry("Long", strategy.long)
    `;

    const res = evaluatePineScript(script, candleMap, '5m');

    if (!res.action) {
        throw new Error('Pine evaluation failed on request.security script');
    }

    console.log(
        '✅ request.security mapping & zero-lookahead evaluation test passed.'
    );
}

if (
    typeof require !== 'undefined' &&
    require.main === module
) {
    testSecurityMapping();
}
