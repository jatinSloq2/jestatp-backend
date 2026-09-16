import { Candle } from '../../brokers/adapters/brokerAdapter.interface';
import { CandlePattern } from '../dsl/constants';

function body(c: Candle) {
  return Math.abs(c.close - c.open);
}
function range(c: Candle) {
  return Math.max(c.high - c.low, 1e-9);
}
function upperWick(c: Candle) {
  return c.high - Math.max(c.open, c.close);
}
function lowerWick(c: Candle) {
  return Math.min(c.open, c.close) - c.low;
}
function isBullish(c: Candle) {
  return c.close > c.open;
}
function isBearish(c: Candle) {
  return c.close < c.open;
}

/** True if the candle at `i` shows the given pattern, using up to 2 prior candles (for multi-candle patterns). */
export function matchesPattern(candles: Candle[], i: number, pattern: CandlePattern): boolean {
  const c = candles[i];
  const prev = candles[i - 1];
  const prev2 = candles[i - 2];
  const r = range(c);
  const b = body(c);
  const bodyRatio = b / r;

  switch (pattern) {
    case 'doji':
      return bodyRatio < 0.1;

    case 'marubozu':
      return bodyRatio > 0.9 && upperWick(c) / r < 0.03 && lowerWick(c) / r < 0.03;

    case 'spinning_top':
      return bodyRatio < 0.35 && upperWick(c) / r > 0.25 && lowerWick(c) / r > 0.25;

    case 'hammer':
      return isBullish(c) && lowerWick(c) / r > 0.5 && bodyRatio < 0.35 && upperWick(c) / r < 0.15;

    case 'inverted_hammer':
      return upperWick(c) / r > 0.5 && bodyRatio < 0.35 && lowerWick(c) / r < 0.15;

    case 'hanging_man':
      // Same shape as a hammer, but the context (a prior uptrend) is what makes it bearish —
      // the shape check alone is what we can evaluate without a full trend model.
      return !!prev && isBullish(prev) && lowerWick(c) / r > 0.5 && bodyRatio < 0.35 && upperWick(c) / r < 0.15;

    case 'shooting_star':
      return !!prev && isBullish(prev) && upperWick(c) / r > 0.5 && bodyRatio < 0.35 && lowerWick(c) / r < 0.15;

    case 'bullish_engulfing':
      return (
        !!prev &&
        isBearish(prev) &&
        isBullish(c) &&
        c.open <= prev.close &&
        c.close >= prev.open &&
        b > body(prev)
      );

    case 'bearish_engulfing':
      return (
        !!prev &&
        isBullish(prev) &&
        isBearish(c) &&
        c.open >= prev.close &&
        c.close <= prev.open &&
        b > body(prev)
      );

    case 'piercing_line':
      return (
        !!prev &&
        isBearish(prev) &&
        isBullish(c) &&
        c.open < prev.low &&
        c.close > prev.open - body(prev) / 2 &&
        c.close < prev.open
      );

    case 'dark_cloud_cover':
      return (
        !!prev &&
        isBullish(prev) &&
        isBearish(c) &&
        c.open > prev.high &&
        c.close < prev.open + body(prev) / 2 &&
        c.close > prev.open
      );

    case 'morning_star':
      return (
        !!prev &&
        !!prev2 &&
        isBearish(prev2) &&
        body(prev) / range(prev) < 0.3 &&
        isBullish(c) &&
        c.close > (prev2.open + prev2.close) / 2
      );

    case 'evening_star':
      return (
        !!prev &&
        !!prev2 &&
        isBullish(prev2) &&
        body(prev) / range(prev) < 0.3 &&
        isBearish(c) &&
        c.close < (prev2.open + prev2.close) / 2
      );

    case 'three_white_soldiers':
      return (
        !!prev &&
        !!prev2 &&
        isBullish(prev2) &&
        isBullish(prev) &&
        isBullish(c) &&
        prev.close > prev2.close &&
        c.close > prev.close
      );

    case 'three_black_crows':
      return (
        !!prev &&
        !!prev2 &&
        isBearish(prev2) &&
        isBearish(prev) &&
        isBearish(c) &&
        prev.close < prev2.close &&
        c.close < prev.close
      );

    default:
      return false;
  }
}

/** Checks the pattern across the last `lookback` candles ending at `i` (default: just the current candle). */
export function candlePatternOccurred(candles: Candle[], i: number, pattern: CandlePattern, lookback = 1): boolean {
  for (let offset = 0; offset < lookback; offset++) {
    const idx = i - offset;
    if (idx < 0) continue;
    if (matchesPattern(candles, idx, pattern)) return true;
  }
  return false;
}