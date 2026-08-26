import { Candle } from '../config/types';
import { PineTALib } from '../../../breakoutex-ai-mobile/src/pine-engine/ta';
import { FloatSeriesBuffer } from '../../../breakoutex-ai-mobile/src/pine-engine/buffers';
import { MTFSecurityEngine } from '../../../breakoutex-ai-mobile/src/pine-engine/mtf/security';
import { PineCandle } from '../../../breakoutex-ai-mobile/src/pine-engine/types';

async function fetchBinanceKlines(symbol: string, interval: string, limit = 500): Promise<Candle[]> {
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = (await resp.json()) as any[][];
    return raw.map(d => ({
        timestamp: Number(d[0]),
        open: Number(d[1]),
        high: Number(d[2]),
        low: Number(d[3]),
        close: Number(d[4]),
        volume: Number(d[5]),
    }));
}

async function debugAlign() {
    const candles5m = await fetchBinanceKlines('ETHUSDT', '5m', 1000);
    const candles4h = await fetchBinanceKlines('ETHUSDT', '4h', 300);

    const mobileCandles5m: PineCandle[] = candles5m.map(c => ({
        time: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));

    const mobileCandles4h: PineCandle[] = candles4h.map(c => ({
        time: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));

    console.log(`4H Candle 0 time: ${new Date(mobileCandles4h[0].time).toISOString()}`);
    console.log(`4H Candle 299 time: ${new Date(mobileCandles4h[299].time).toISOString()}`);
    console.log(`5M Candle 0 time: ${new Date(mobileCandles5m[0].time).toISOString()}`);
    console.log(`5M Candle 73 time: ${new Date(mobileCandles5m[73].time).toISOString()}`);

    const applyOffset = (computeFn: any) => {
        return (htfC: any, htfBuf: any) => {
            const raw = computeFn(htfC, htfBuf);
            const shifted = new Float64Array(raw.length);
            for (let i = 0; i < raw.length; i++) {
                shifted[i] = i >= 1 ? raw[i - 1] : NaN;
            }
            return shifted;
        };
    };

    const aligned = MTFSecurityEngine.alignHTFSeries(
        mobileCandles5m,
        '240',
        applyOffset((htfC: any, htfBuf: any) => {
            const res = new Float64Array(htfC.length);
            let prev = NaN;
            for (let i = 0; i < htfC.length; i++) {
                htfBuf.push(htfC[i].close);
                prev = PineTALib.ema(htfBuf, 50, prev);
                res[i] = prev;
            }
            return res;
        }),
        'gaps_off',
        mobileCandles4h
    );

    console.log(`Aligned data length: ${aligned.alignedBaseValues.length}`);
    console.log(`Aligned value at 0: ${aligned.alignedBaseValues.get(0)}`);
    console.log(`Aligned value at 73: ${aligned.alignedBaseValues.get(73)}`);
    console.log(`Raw htfValues[280]: ${aligned.htfValues[280]}`);
}

debugAlign().catch(console.error);
