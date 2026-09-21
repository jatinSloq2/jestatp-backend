import { Candle } from '../../brokers/adapters/brokerAdapter.interface';
import { Condition, ConditionOperand, IndicatorRef } from '../dsl/types';
import { computeIndicatorSeries } from './indicators';
import { candlePatternOccurred } from './candlePatterns';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Fixed lookback window for support/resistance proximity checks — the DSL doesn't expose this as a parameter. */
const SUPPORT_RESISTANCE_WINDOW = 20;
/** Fixed lookback window (in bars) used to classify trend/volatility for `market_condition` checks. */
const MARKET_CONDITION_WINDOW = 20;

/** A tiny, explicitly-whitelisted arithmetic evaluator for `custom_formula` conditions — no network/global access, just numeric operators over the candle's own fields. */
function evaluateCustomFormula(formula: string, ctx: Record<string, number>): boolean {
  const allowedPattern = /^[\s0-9a-zA-Z_+\-*/%().<>=!&|?:]*$/;
  if (!allowedPattern.test(formula)) {
    throw new Error(`custom_formula contains disallowed characters: ${formula}`);
  }
  const varNames = Object.keys(ctx);
  const varValues = Object.values(ctx);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...varNames, `"use strict"; return Boolean(${formula});`);
  return fn(...varValues);
}

export class ConditionEvaluator {
  private candles: Candle[];
  private seriesCache = new Map<string, number[]>();

  constructor(candles: Candle[]) {
    this.candles = candles;
  }

  private getIndicatorSeries(ref: IndicatorRef): number[] {
    const key = `${ref.indicator}:${JSON.stringify(ref.params ?? {})}`;
    let series = this.seriesCache.get(key);
    if (!series) {
      series = computeIndicatorSeries(this.candles, ref.indicator, ref.params ?? {});
      this.seriesCache.set(key, series);
    }
    return series;
  }

  private resolveOperandValue(operand: ConditionOperand, i: number): number | [number, number] {
    if (Array.isArray(operand)) return operand;
    if (typeof operand === 'number') return operand;
    return this.getIndicatorSeries(operand)[i];
  }

  private compare(current: number, previous: number | undefined, operator: string, operand: ConditionOperand, i: number): boolean {
    if (Number.isNaN(current)) return false;

    if (operator === 'cross_above' || operator === 'cross_below') {
      if (previous === undefined || Number.isNaN(previous)) return false;
      const targetNow = this.resolveOperandValue(operand, i);
      const targetPrev = this.resolveOperandValue(operand, i - 1);
      if (Array.isArray(targetNow) || Array.isArray(targetPrev)) return false; // crossing a range isn't meaningful
      if (Number.isNaN(targetNow) || Number.isNaN(targetPrev)) return false;
      if (operator === 'cross_above') return previous <= targetPrev && current > targetNow;
      return previous >= targetPrev && current < targetNow;
    }

    const target = this.resolveOperandValue(operand, i);
    if (operator === 'between') {
      if (!Array.isArray(target)) return false;
      return current >= target[0] && current <= target[1];
    }
    if (Array.isArray(target)) return false;
    if (Number.isNaN(target)) return false;

    switch (operator) {
      case '>':
        return current > target;
      case '<':
        return current < target;
      case '>=':
        return current >= target;
      case '<=':
        return current <= target;
      case '==':
        return current === target;
      case '!=':
        return current !== target;
      default:
        return false;
    }
  }

  private istTimeOfDay(timestamp: number): string {
    const ist = new Date(timestamp + IST_OFFSET_MS);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
  }

  private evaluateLeaf(condition: Condition, i: number): boolean {
    const c = this.candles[i];

    switch (condition.type) {
      case 'indicator': {
        const series = this.getIndicatorSeries({ indicator: condition.indicator, params: condition.params });
        return this.compare(series[i], series[i - 1], condition.operator, condition.value, i);
      }

      case 'candle_pattern':
        return candlePatternOccurred(this.candles, i, condition.pattern, condition.lookback ?? 1);

      case 'price_action': {
        const value = c[condition.field];
        const prevValue = i > 0 ? this.candles[i - 1][condition.field] : undefined;
        return this.compare(value, prevValue, condition.operator, condition.value, i);
      }

      case 'volume': {
        if (typeof condition.compareTo === 'number') {
          return this.compareOp(c.volume, condition.operator, condition.compareTo);
        }
        const period = condition.compareTo.period;
        const start = Math.max(0, i - period + 1);
        const window = this.candles.slice(start, i + 1);
        const avg = window.reduce((sum, w) => sum + w.volume, 0) / window.length;
        return this.compareOp(c.volume, condition.operator, avg);
      }

      case 'breakout': {
        const start = Math.max(0, i - condition.lookbackPeriod);
        const window = this.candles.slice(start, i); // excludes current bar — breakout is vs prior range
        if (window.length === 0) return false;
        const buffer = (condition.bufferPercent ?? 0) / 100;
        if (condition.level === 'high' || condition.level === 'resistance') {
          const priorHigh = Math.max(...window.map((w) => w.high));
          return c.close > priorHigh * (1 + buffer);
        }
        const priorLow = Math.min(...window.map((w) => w.low));
        return c.close < priorLow * (1 - buffer);
      }

      case 'support_resistance': {
        const start = Math.max(0, i - SUPPORT_RESISTANCE_WINDOW);
        const window = this.candles.slice(start, i + 1);
        const level = condition.level === 'support' ? Math.min(...window.map((w) => w.low)) : Math.max(...window.map((w) => w.high));
        const distancePercent = (Math.abs(c.close - level) / level) * 100;
        return distancePercent <= condition.proximityPercent;
      }

      case 'time': {
        const t = this.istTimeOfDay(c.timestamp);
        if (condition.operator === 'before') return t < (condition.value as string);
        if (condition.operator === 'after') return t > (condition.value as string);
        const [from, to] = condition.value as [string, string];
        return t >= from && t <= to;
      }

      case 'market_condition': {
        return this.evaluateMarketCondition(condition.condition, i);
      }

      case 'custom_formula': {
        const prev = i > 0 ? this.candles[i - 1] : c;
        return evaluateCustomFormula(condition.formula, {
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          prevClose: prev.close,
          prevOpen: prev.open,
          prevHigh: prev.high,
          prevLow: prev.low,
        });
      }

      default:
        return false;
    }
  }

  private compareOp(current: number, operator: string, target: number): boolean {
    switch (operator) {
      case '>':
        return current > target;
      case '<':
        return current < target;
      case '>=':
        return current >= target;
      case '<=':
        return current <= target;
      case '==':
        return current === target;
      case '!=':
        return current !== target;
      default:
        return false;
    }
  }

  private evaluateMarketCondition(condition: string, i: number): boolean {
    const start = Math.max(0, i - MARKET_CONDITION_WINDOW);
    const window = this.candles.slice(start, i + 1);
    if (window.length < 2) return false;
    const c = this.candles[i];
    const prev = this.candles[i - 1];

    switch (condition) {
      case 'trending_up':
      case 'trending_down': {
        const emaFast = this.getIndicatorSeries({ indicator: 'EMA', params: { period: 9 } })[i];
        const emaSlow = this.getIndicatorSeries({ indicator: 'EMA', params: { period: 21 } })[i];
        if (Number.isNaN(emaFast) || Number.isNaN(emaSlow)) return false;
        return condition === 'trending_up' ? emaFast > emaSlow : emaFast < emaSlow;
      }
      case 'sideways': {
        const emaFast = this.getIndicatorSeries({ indicator: 'EMA', params: { period: 9 } })[i];
        const emaSlow = this.getIndicatorSeries({ indicator: 'EMA', params: { period: 21 } })[i];
        if (Number.isNaN(emaFast) || Number.isNaN(emaSlow)) return false;
        return Math.abs(emaFast - emaSlow) / emaSlow < 0.002;
      }
      case 'high_volatility':
      case 'low_volatility': {
        const atrSeries = this.getIndicatorSeries({ indicator: 'ATR', params: { period: 14 } });
        const current = atrSeries[i];
        if (Number.isNaN(current)) return false;
        const history = atrSeries.slice(start, i + 1).filter((v) => !Number.isNaN(v));
        if (history.length === 0) return false;
        const avg = history.reduce((a, b) => a + b, 0) / history.length;
        return condition === 'high_volatility' ? current > avg * 1.25 : current < avg * 0.75;
      }
      case 'above_vwap':
      case 'below_vwap': {
        const vwapSeries = this.getIndicatorSeries({ indicator: 'VWAP' });
        const v = vwapSeries[i];
        if (Number.isNaN(v)) return false;
        return condition === 'above_vwap' ? c.close > v : c.close < v;
      }
      case 'gap_up':
        return c.open > prev.close * 1.002;
      case 'gap_down':
        return c.open < prev.close * 0.998;
      default:
        return false;
    }
  }

  /** Evaluates a full condition tree (leaf or group) at bar index `i`. */
  evaluate(condition: Condition, i: number): boolean {
    if (condition.type === 'group') {
      const results = condition.conditions.map((c) => this.evaluate(c, i));
      return condition.operator === 'OR' ? results.some(Boolean) : results.every(Boolean);
    }
    return this.evaluateLeaf(condition, i);
  }

  /** Evaluates an entry/exit block's top-level condition list, combined with its own logic (default AND). */
  evaluateBlock(conditions: Condition[], logic: 'AND' | 'OR' | undefined, i: number): boolean {
    if (conditions.length === 0) return false;
    const results = conditions.map((c) => this.evaluate(c, i));
    return (logic ?? 'AND') === 'OR' ? results.some(Boolean) : results.every(Boolean);
  }

  /**
   * Same evaluation as `evaluate`, but building a human-readable trace
   * instead of (well, alongside) just the boolean — this is what powers
   * the per-trade debugger ("Conditions at Entry" in the design doc): for
   * each leaf, what indicator/field value it actually saw on this bar and
   * whether that leaf passed, so a trade can be explained rather than just
   * shown. Deliberately a *separate* method from `evaluate`/`evaluateLeaf`
   * — building description strings on every bar of a backtest would be
   * wasted work, so this is only ever called once, at the single bar index
   * a trade actually opened on (see backtestEngine.ts's `explainEntryAt`).
   */
  explain(condition: Condition, i: number): ConditionExplanation {
    if (condition.type === 'group') {
      const children = condition.conditions.map((c) => this.explain(c, i));
      const result = condition.operator === 'OR' ? children.some((c) => c.result) : children.every((c) => c.result);
      return { description: `${condition.operator} of ${children.length} condition${children.length === 1 ? '' : 's'}`, result, children };
    }
    return this.explainLeaf(condition, i);
  }

  explainBlock(conditions: Condition[], logic: 'AND' | 'OR' | undefined, i: number): ConditionExplanation {
    const children = conditions.map((c) => this.explain(c, i));
    const result = conditions.length > 0 && ((logic ?? 'AND') === 'OR' ? children.some((c) => c.result) : children.every((c) => c.result));
    return { description: `${logic ?? 'AND'} of ${children.length} condition${children.length === 1 ? '' : 's'}`, result, children };
  }

  private describeOperator(operator: string): string {
    const names: Record<string, string> = {
      '>': '>', '<': '<', '>=': '≥', '<=': '≤', '==': '=', '!=': '≠',
      cross_above: 'crosses above', cross_below: 'crosses below', between: 'between',
    };
    return names[operator] ?? operator;
  }

  private formatOperand(operand: ConditionOperand): string {
    if (Array.isArray(operand)) return `[${operand[0]}, ${operand[1]}]`;
    if (typeof operand === 'number') return String(operand);
    return `${operand.indicator}${operand.params ? `(${Object.values(operand.params).join(', ')})` : ''}`;
  }

  private explainLeaf(condition: Condition, i: number): ConditionExplanation {
    const result = this.evaluateLeaf(condition, i);

    switch (condition.type) {
      case 'indicator': {
        const series = this.getIndicatorSeries({ indicator: condition.indicator, params: condition.params });
        const value = series[i];
        return {
          description: `${condition.indicator}${condition.params ? `(${Object.values(condition.params).join(', ')})` : ''} ${this.describeOperator(condition.operator)} ${this.formatOperand(condition.value)}`,
          result,
          value: Number.isNaN(value) ? null : value,
        };
      }
      case 'price_action': {
        const value = this.candles[i][condition.field];
        return { description: `${condition.field} ${this.describeOperator(condition.operator)} ${this.formatOperand(condition.value)}`, result, value };
      }
      case 'volume': {
        const value = this.candles[i].volume;
        const target = typeof condition.compareTo === 'number' ? condition.compareTo : `${condition.compareTo.period}-bar avg volume`;
        return { description: `volume ${this.describeOperator(condition.operator)} ${target}`, result, value };
      }
      case 'candle_pattern':
        return { description: `candle pattern: ${condition.pattern}`, result };
      case 'breakout':
        return { description: `breakout above/below ${condition.lookbackPeriod}-bar ${condition.level}`, result, value: this.candles[i].close };
      case 'support_resistance':
        return { description: `within ${condition.proximityPercent}% of ${condition.level}`, result, value: this.candles[i].close };
      case 'time':
        return { description: `time ${condition.operator} ${JSON.stringify(condition.value)}`, result, value: null };
      case 'market_condition':
        return { description: `market condition: ${condition.condition}`, result };
      case 'custom_formula':
        return { description: `custom formula: ${condition.formula}`, result };
      default:
        return { description: 'unknown condition', result };
    }
  }
}

export interface ConditionExplanation {
  description: string;
  result: boolean;
  value?: number | null;
  children?: ConditionExplanation[];
}