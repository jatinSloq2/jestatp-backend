/**
 * The catalog of everything the Strategy Builder's Strategy JSON DSL supports,
 * straight out of the platform spec's Phase 4 component list. This is the
 * single source of truth for:
 *   - Joi validation (schema.ts) — which indicator/operator names are legal
 *   - The `/strategies/meta/indicators` endpoint — what the frontend's visual
 *     builder renders as dropdown options
 */

export const INDICATOR_NAMES = [
  'SMA',
  'EMA',
  'VWAP',
  'RSI',
  'MACD',
  'BBANDS', // Bollinger Bands
  'SUPERTREND',
  'ATR',
  'ADX',
  'STOCHASTIC',
] as const;
export type IndicatorName = (typeof INDICATOR_NAMES)[number];

/** Per-indicator parameter shape, used both for validation and for the meta catalog. */
export const INDICATOR_PARAM_SPECS: Record<
  IndicatorName,
  { params: { name: string; type: 'integer' | 'float'; min: number; max: number; default: number }[]; description: string }
> = {
  SMA: { description: 'Simple Moving Average', params: [{ name: 'period', type: 'integer', min: 2, max: 500, default: 20 }] },
  EMA: { description: 'Exponential Moving Average', params: [{ name: 'period', type: 'integer', min: 2, max: 500, default: 20 }] },
  VWAP: { description: 'Volume Weighted Average Price (session-anchored)', params: [] },
  RSI: { description: 'Relative Strength Index', params: [{ name: 'period', type: 'integer', min: 2, max: 200, default: 14 }] },
  MACD: {
    description: 'Moving Average Convergence Divergence',
    params: [
      { name: 'fastPeriod', type: 'integer', min: 2, max: 200, default: 12 },
      { name: 'slowPeriod', type: 'integer', min: 2, max: 200, default: 26 },
      { name: 'signalPeriod', type: 'integer', min: 2, max: 200, default: 9 },
    ],
  },
  BBANDS: {
    description: 'Bollinger Bands',
    params: [
      { name: 'period', type: 'integer', min: 2, max: 200, default: 20 },
      { name: 'stdDev', type: 'float', min: 0.5, max: 5, default: 2 },
    ],
  },
  SUPERTREND: {
    description: 'Supertrend',
    params: [
      { name: 'period', type: 'integer', min: 2, max: 200, default: 10 },
      { name: 'multiplier', type: 'float', min: 0.5, max: 10, default: 3 },
    ],
  },
  ATR: { description: 'Average True Range', params: [{ name: 'period', type: 'integer', min: 2, max: 200, default: 14 }] },
  ADX: { description: 'Average Directional Index', params: [{ name: 'period', type: 'integer', min: 2, max: 200, default: 14 }] },
  STOCHASTIC: {
    description: 'Stochastic Oscillator',
    params: [
      { name: 'kPeriod', type: 'integer', min: 2, max: 200, default: 14 },
      { name: 'dPeriod', type: 'integer', min: 2, max: 200, default: 3 },
      { name: 'smooth', type: 'integer', min: 1, max: 50, default: 3 },
    ],
  },
};

export const COMPARISON_OPERATORS = ['>', '<', '>=', '<=', '==', '!=', 'between'] as const;
export const CROSS_OPERATORS = ['cross_above', 'cross_below'] as const;
export const ALL_OPERATORS = [...COMPARISON_OPERATORS, ...CROSS_OPERATORS] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];
export type CrossOperator = (typeof CROSS_OPERATORS)[number];
export type Operator = (typeof ALL_OPERATORS)[number];

export const CANDLE_PATTERNS = [
  'bullish_engulfing',
  'bearish_engulfing',
  'hammer',
  'inverted_hammer',
  'hanging_man',
  'shooting_star',
  'doji',
  'morning_star',
  'evening_star',
  'three_white_soldiers',
  'three_black_crows',
  'marubozu',
  'spinning_top',
  'piercing_line',
  'dark_cloud_cover',
] as const;
export type CandlePattern = (typeof CANDLE_PATTERNS)[number];

export const MARKET_CONDITIONS = [
  'trending_up',
  'trending_down',
  'sideways',
  'high_volatility',
  'low_volatility',
  'above_vwap',
  'below_vwap',
  'gap_up',
  'gap_down',
] as const;
export type MarketCondition = (typeof MARKET_CONDITIONS)[number];

export const PRICE_FIELDS = ['open', 'high', 'low', 'close'] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];

export const BREAKOUT_LEVELS = ['high', 'low', 'resistance', 'support'] as const;
export type BreakoutLevel = (typeof BREAKOUT_LEVELS)[number];

export const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '1d'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const POSITION_SIZING_METHODS = ['fixed_quantity', 'fixed_capital', 'percent_of_capital'] as const;
export type PositionSizingMethod = (typeof POSITION_SIZING_METHODS)[number];

export const STOP_LOSS_TARGET_TYPES = ['percent', 'points'] as const;
export type StopLossTargetType = (typeof STOP_LOSS_TARGET_TYPES)[number];

export const STRATEGY_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];

export const EXECUTION_MODES = ['paper', 'live'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];
