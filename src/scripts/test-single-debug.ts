import { STRATEGY_LIBRARY } from '../pine/strategy-library';
import { evaluatePineScript } from '../pine/interpreter';
import { backtestStrategy } from '../pine/backtester';

const candles = Array.from({length: 100}, (_, i) => ({
  timestamp: 1000 + i * 300000,
  open: 2000 + i, high: 2010 + i, low: 1990 + i, close: 2005 + i, volume: 100
}));
const map = new Map([['5m', candles], ['15m', candles]]);

console.log('Testing mtf_failed_breakout with evaluatePineScript...');
try {
  const res = evaluatePineScript(STRATEGY_LIBRARY.mtf_failed_breakout.pineScript, map, '5m');
  console.log('evaluatePineScript Result:', res);
} catch (e: any) {
  console.error('Error in evaluatePineScript:', e.message, e.stack);
}

console.log('\nTesting backtestStrategy...');
try {
  const res2 = backtestStrategy(STRATEGY_LIBRARY.mtf_failed_breakout, map, '5m', 100);
  console.log('backtestStrategy Total Trades:', res2.totalTrades);
} catch (e: any) {
  console.error('Error in backtestStrategy:', e.message, e.stack);
}
