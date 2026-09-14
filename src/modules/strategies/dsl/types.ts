import {
  BreakoutLevel,
  CandlePattern,
  IndicatorName,
  MarketCondition,
  Operator,
  PositionSizingMethod,
  PriceField,
  StopLossTargetType,
  Timeframe,
} from './constants';

/** A reference to a live indicator series, e.g. { indicator: "EMA", period: 21 }. */
export interface IndicatorRef {
  indicator: IndicatorName;
  params?: Record<string, number>;
}

/** The right-hand side of a condition: a literal number, a [min,max] range, or another indicator series. */
export type ConditionOperand = number | [number, number] | IndicatorRef;

export interface IndicatorCondition {
  type: 'indicator';
  indicator: IndicatorName;
  params?: Record<string, number>;
  operator: Operator;
  value: ConditionOperand;
}

export interface CandlePatternCondition {
  type: 'candle_pattern';
  pattern: CandlePattern;
  /** How many of the last N candles must show the pattern (default 1 — the current candle). */
  lookback?: number;
}

export interface PriceActionCondition {
  type: 'price_action';
  field: PriceField;
  operator: Operator;
  value: ConditionOperand;
}

export interface VolumeCondition {
  type: 'volume';
  operator: Operator;
  /** Compare against a plain number or the average volume over N candles. */
  compareTo: number | { type: 'average_volume'; period: number };
}

export interface BreakoutCondition {
  type: 'breakout';
  level: BreakoutLevel;
  lookbackPeriod: number;
  /** Optional buffer so "breakout" doesn't fire on a 1-tick poke through the level. */
  bufferPercent?: number;
}

export interface SupportResistanceCondition {
  type: 'support_resistance';
  level: 'support' | 'resistance';
  proximityPercent: number;
}

export interface TimeCondition {
  type: 'time';
  operator: 'before' | 'after' | 'between';
  /** "HH:mm" (24h) for before/after, or ["HH:mm", "HH:mm"] for between. */
  value: string | [string, string];
}

export interface MarketConditionCondition {
  type: 'market_condition';
  condition: MarketCondition;
}

export interface CustomFormulaCondition {
  type: 'custom_formula';
  /** Evaluated by the Strategy Engine at execution time — validated here only for shape/safety, not executed. */
  formula: string;
}

export type LeafCondition =
  | IndicatorCondition
  | CandlePatternCondition
  | PriceActionCondition
  | VolumeCondition
  | BreakoutCondition
  | SupportResistanceCondition
  | TimeCondition
  | MarketConditionCondition
  | CustomFormulaCondition;

export interface GroupCondition {
  type: 'group';
  operator: 'AND' | 'OR';
  conditions: Condition[];
}

export type Condition = LeafCondition | GroupCondition;

export interface StopLossConfig {
  type: StopLossTargetType;
  value: number;
}

export interface TargetConfig {
  type: StopLossTargetType;
  value: number;
}

export interface TrailingStopLossConfig {
  enabled: boolean;
  type: StopLossTargetType;
  value: number;
}

export interface TimeBasedExitConfig {
  enabled: boolean;
  /** "HH:mm" — force-exit any open position at this time. */
  exitTime: string;
}

export interface PositionSizingConfig {
  method: PositionSizingMethod;
  value: number;
}

/** Strategy-level risk limits, matching the doc's "Strategy Capital / Max loss/day / Max positions / Max trades/day" example. */
export interface RiskConfig {
  capitalAllocated: number;
  maxLossPerDay: number;
  maxPositions: number;
  maxTradesPerDay: number;
  positionSizing: PositionSizingConfig;
  stopLoss: StopLossConfig;
  target: TargetConfig;
  trailingStopLoss?: TrailingStopLossConfig;
  timeBasedExit?: TimeBasedExitConfig;
}

export interface EntryBlock {
  conditions: Condition[];
  /** How the top-level conditions combine — a single implicit group. Defaults to AND. */
  logic?: 'AND' | 'OR';
}

export interface ExitBlock {
  conditions: Condition[];
  logic?: 'AND' | 'OR';
}

/** The full machine-executable "Strategy JSON" the doc's pipeline (Builder -> JSON -> Validator -> Engine) revolves around. */
export interface StrategyDefinition {
  instrument: string;
  exchange: string;
  timeframe: Timeframe;
  entry: EntryBlock;
  exit: ExitBlock;
  risk: RiskConfig;
}
