import { Candle } from '../../brokers/adapters/brokerAdapter.interface';
import { IndicatorName } from '../dsl/constants';

const NA = NaN;

export function sma(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NA);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NA);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) {
      // Seed with a plain SMA of the first `period` values, the conventional way to start an EMA.
      if (i >= period - 1) {
        const seed = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
        out[i] = seed;
        prev = seed;
      }
    } else {
      const val: number = values[i] * k + prev * (1 - k);
      out[i] = val;
      prev = val;
    }
  }
  return out;
}

export function rsi(closes: number[], period: number): number[] {
  const out = new Array(closes.length).fill(NA);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        out[i] = rsiFromAvg(avgGain, avgLoss);
      }
    } else {
      // Wilder's smoothing.
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      out[i] = rsiFromAvg(avgGain, avgLoss);
    }
  }
  return out;
}

function rsiFromAvg(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** True Range series (needed by ATR, ADX, Supertrend). */
export function trueRange(candles: Candle[]): number[] {
  const out = new Array(candles.length).fill(NA);
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      out[i] = candles[i].high - candles[i].low;
      continue;
    }
    const prevClose = candles[i - 1].close;
    out[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose),
    );
  }
  return out;
}

export function atr(candles: Candle[], period: number): number[] {
  const tr = trueRange(candles);
  // Wilder's smoothing (same recurrence as RSI's average).
  const out = new Array(candles.length).fill(NA);
  let avg = 0;
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      avg += tr[i];
      if (i === period - 1) {
        avg /= period;
        out[i] = avg;
      }
    } else {
      avg = (avg * (period - 1) + tr[i]) / period;
      out[i] = avg;
    }
  }
  return out;
}

export function vwap(candles: Candle[]): number[] {
  const out = new Array(candles.length).fill(NA);
  let cumPV = 0;
  let cumVol = 0;
  let currentDay = '';
  for (let i = 0; i < candles.length; i++) {
    const day = new Date(candles[i].timestamp).toISOString().slice(0, 10);
    if (day !== currentDay) {
      currentDay = day;
      cumPV = 0;
      cumVol = 0;
    }
    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumPV += typicalPrice * candles[i].volume;
    cumVol += candles[i].volume;
    out[i] = cumVol > 0 ? cumPV / cumVol : typicalPrice;
  }
  return out;
}

export interface MacdResult {
  line: number[];
  signal: number[];
  histogram: number[];
}

export function macd(closes: number[], fastPeriod: number, slowPeriod: number, signalPeriod: number): MacdResult {
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const line = closes.map((_, i) => (Number.isNaN(fast[i]) || Number.isNaN(slow[i]) ? NA : fast[i] - slow[i]));
  const definedLine = line.map((v) => (Number.isNaN(v) ? 0 : v));
  const signalRaw = ema(definedLine, signalPeriod);
  const signal = line.map((v, i) => (Number.isNaN(v) ? NA : signalRaw[i]));
  const histogram = line.map((v, i) => (Number.isNaN(v) || Number.isNaN(signal[i]) ? NA : v - signal[i]));
  return { line, signal, histogram };
}

export interface BollingerResult {
  upper: number[];
  middle: number[];
  lower: number[];
  percentB: number[];
}

export function bbands(closes: number[], period: number, stdDevMultiplier: number): BollingerResult {
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(NA);
  const lower = new Array(closes.length).fill(NA);
  const percentB = new Array(closes.length).fill(NA);
  for (let i = 0; i < closes.length; i++) {
    if (Number.isNaN(middle[i])) continue;
    const window = closes.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const variance = window.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper[i] = mean + stdDevMultiplier * stdDev;
    lower[i] = mean - stdDevMultiplier * stdDev;
    const bandWidth = upper[i] - lower[i];
    percentB[i] = bandWidth > 0 ? (closes[i] - lower[i]) / bandWidth : 0.5;
  }
  return { upper, middle, lower, percentB };
}

export interface StochasticResult {
  k: number[];
  d: number[];
}

export function stochastic(candles: Candle[], kPeriod: number, dPeriod: number, smooth: number): StochasticResult {
  const rawK = new Array(candles.length).fill(NA);
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) continue;
    const window = candles.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...window.map((c) => c.high));
    const lowest = Math.min(...window.map((c) => c.low));
    const range = highest - lowest;
    rawK[i] = range > 0 ? ((candles[i].close - lowest) / range) * 100 : 50;
  }
  const definedRawK = rawK.map((v) => (Number.isNaN(v) ? 0 : v));
  const smoothedRaw = sma(definedRawK, smooth);
  const k = rawK.map((v, i) => (Number.isNaN(v) ? NA : smoothedRaw[i]));
  const definedK = k.map((v) => (Number.isNaN(v) ? 0 : v));
  const dRaw = sma(definedK, dPeriod);
  const d = k.map((v, i) => (Number.isNaN(v) ? NA : dRaw[i]));
  return { k, d };
}

/** Average Directional Index — trend-strength (not direction) indicator. */
export function adx(candles: Candle[], period: number): number[] {
  const out = new Array(candles.length).fill(NA);
  const plusDM = new Array(candles.length).fill(0);
  const minusDM = new Array(candles.length).fill(0);
  const tr = trueRange(candles);

  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  const smoothedTR = wilderSmooth(tr, period);
  const smoothedPlusDM = wilderSmooth(plusDM, period);
  const smoothedMinusDM = wilderSmooth(minusDM, period);

  const dx = new Array(candles.length).fill(NA);
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(smoothedTR[i]) || smoothedTR[i] === 0) continue;
    const plusDI = (smoothedPlusDM[i] / smoothedTR[i]) * 100;
    const minusDI = (smoothedMinusDM[i] / smoothedTR[i]) * 100;
    const sum = plusDI + minusDI;
    dx[i] = sum > 0 ? (Math.abs(plusDI - minusDI) / sum) * 100 : 0;
  }

  const definedDx = dx.map((v) => (Number.isNaN(v) ? 0 : v));
  const adxSeries = sma(definedDx, period);
  for (let i = 0; i < candles.length; i++) {
    out[i] = Number.isNaN(dx[i]) ? NA : adxSeries[i];
  }
  return out;
}

function wilderSmooth(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NA);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      sum += values[i];
      if (i === period - 1) out[i] = sum;
    } else {
      const prev = out[i - 1];
      out[i] = Number.isNaN(prev) ? NA : prev - prev / period + values[i];
    }
  }
  return out;
}

export interface SupertrendResult {
  value: number[];
  /** 1 = uptrend (support line, price above), -1 = downtrend (resistance line, price below). */
  direction: number[];
}

export function supertrend(candles: Candle[], period: number, multiplier: number): SupertrendResult {
  const atrSeries = atr(candles, period);
  const value = new Array(candles.length).fill(NA);
  const direction = new Array(candles.length).fill(NA);

  let prevUpperBand = NA;
  let prevLowerBand = NA;
  let prevSupertrend = NA;
  let prevDirection = 1;

  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(atrSeries[i])) continue;
    const mid = (candles[i].high + candles[i].low) / 2;
    let upperBand = mid + multiplier * atrSeries[i];
    let lowerBand = mid - multiplier * atrSeries[i];

    if (!Number.isNaN(prevUpperBand)) {
      upperBand = upperBand < prevUpperBand || candles[i - 1].close > prevUpperBand ? upperBand : prevUpperBand;
      lowerBand = lowerBand > prevLowerBand || candles[i - 1].close < prevLowerBand ? lowerBand : prevLowerBand;
    }

    let dir = prevDirection;
    if (Number.isNaN(prevSupertrend)) {
      dir = candles[i].close > upperBand ? 1 : -1;
    } else if (prevDirection === 1) {
      dir = candles[i].close < lowerBand ? -1 : 1;
    } else {
      dir = candles[i].close > upperBand ? 1 : -1;
    }

    const st = dir === 1 ? lowerBand : upperBand;
    value[i] = st;
    direction[i] = dir;

    prevUpperBand = upperBand;
    prevLowerBand = lowerBand;
    prevSupertrend = st;
    prevDirection = dir;
  }

  return { value, direction };
}

/**
 * Computes the "default" comparable series for a given indicator name —
 * the single number series an `IndicatorCondition` compares against, since
 * the DSL only names one indicator per side of a comparison. Multi-line
 * indicators collapse to the most commonly-compared line:
 *   MACD -> histogram (macd - signal; comparing to 0 is the standard "cross" signal)
 *   BBANDS -> %B (0 = at lower band, 1 = at upper band; keeps it comparable via plain operators)
 *   STOCHASTIC -> %D (the smoothed, less noisy line)
 *   SUPERTREND -> the supertrend line's price value
 */
export function computeIndicatorSeries(candles: Candle[], indicator: IndicatorName, params: Record<string, number> = {}): number[] {
  const closes = candles.map((c) => c.close);
  switch (indicator) {
    case 'SMA':
      return sma(closes, params.period ?? 20);
    case 'EMA':
      return ema(closes, params.period ?? 20);
    case 'VWAP':
      return vwap(candles);
    case 'RSI':
      return rsi(closes, params.period ?? 14);
    case 'MACD':
      return macd(closes, params.fastPeriod ?? 12, params.slowPeriod ?? 26, params.signalPeriod ?? 9).histogram;
    case 'BBANDS':
      return bbands(closes, params.period ?? 20, params.stdDev ?? 2).percentB;
    case 'SUPERTREND':
      return supertrend(candles, params.period ?? 10, params.multiplier ?? 3).value;
    case 'ATR':
      return atr(candles, params.period ?? 14);
    case 'ADX':
      return adx(candles, params.period ?? 14);
    case 'STOCHASTIC':
      return stochastic(candles, params.kPeriod ?? 14, params.dPeriod ?? 3, params.smooth ?? 3).d;
    default:
      return new Array(candles.length).fill(NA);
  }
}