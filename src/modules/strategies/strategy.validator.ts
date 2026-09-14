import { ApiError } from '../../utils/ApiError';
import { INDICATOR_PARAM_SPECS, IndicatorName } from './dsl/constants';
import { Condition, ConditionOperand, IndicatorRef, StrategyDefinition } from './dsl/types';

/** Tokens that should never appear in a "custom formula" string, even though the Joi character whitelist already blocks most injection surface. */
const FORMULA_BLOCKLIST = ['process', 'require', 'import', 'eval', '__proto__', 'constructor', 'global', 'module'];

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

function isIndicatorRef(operand: ConditionOperand): operand is IndicatorRef {
  return typeof operand === 'object' && !Array.isArray(operand) && operand !== null && 'indicator' in operand;
}

function checkIndicatorParams(indicator: IndicatorName, params: Record<string, number> | undefined, path: string, issues: ValidationIssue[]) {
  const spec = INDICATOR_PARAM_SPECS[indicator];
  if (!spec) return; // unreachable given Joi's enum check, but defensive
  for (const p of spec.params) {
    const value = params?.[p.name] ?? p.default;
    if (typeof value !== 'number' || Number.isNaN(value)) {
      issues.push({ path: `${path}.params.${p.name}`, message: `${indicator}.${p.name} must be a number` });
      continue;
    }
    if (value < p.min || value > p.max) {
      issues.push({ path: `${path}.params.${p.name}`, message: `${indicator}.${p.name} must be between ${p.min} and ${p.max}` });
    }
  }
  if (indicator === 'MACD') {
    const fast = params?.fastPeriod ?? 12;
    const slow = params?.slowPeriod ?? 26;
    if (fast >= slow) {
      issues.push({ path: `${path}.params`, message: 'MACD fastPeriod must be smaller than slowPeriod' });
    }
  }
}

function checkOperand(operand: ConditionOperand, path: string, issues: ValidationIssue[]) {
  if (isIndicatorRef(operand)) {
    checkIndicatorParams(operand.indicator, operand.params, path, issues);
  } else if (Array.isArray(operand)) {
    if (operand[0] >= operand[1]) {
      issues.push({ path, message: '"between" range must have min < max' });
    }
  }
}

function walkCondition(condition: Condition, path: string, issues: ValidationIssue[]) {
  switch (condition.type) {
    case 'indicator': {
      checkIndicatorParams(condition.indicator, condition.params, path, issues);
      checkOperand(condition.value, `${path}.value`, issues);

      if ((condition.operator === 'cross_above' || condition.operator === 'cross_below') && !isIndicatorRef(condition.value)) {
        issues.push({
          path: `${path}.value`,
          message: `"${condition.operator}" compares two live series — the value must reference another indicator, not a fixed number`,
        });
      }
      if (condition.operator === 'between' && !Array.isArray(condition.value)) {
        issues.push({ path: `${path}.value`, message: '"between" requires a [min, max] value' });
      }
      break;
    }

    case 'price_action': {
      checkOperand(condition.value, `${path}.value`, issues);
      break;
    }

    case 'volume': {
      if (typeof condition.compareTo === 'object' && condition.compareTo.period < 2) {
        issues.push({ path: `${path}.compareTo.period`, message: 'average_volume period must be at least 2' });
      }
      break;
    }

    case 'breakout': {
      if (condition.lookbackPeriod < 2) {
        issues.push({ path: `${path}.lookbackPeriod`, message: 'lookbackPeriod must be at least 2 candles' });
      }
      break;
    }

    case 'time': {
      if (condition.operator === 'between' && Array.isArray(condition.value)) {
        const [start, end] = condition.value;
        if (start >= end) {
          issues.push({ path: `${path}.value`, message: 'Time range start must be before end' });
        }
      }
      break;
    }

    case 'custom_formula': {
      const lower = condition.formula.toLowerCase();
      for (const banned of FORMULA_BLOCKLIST) {
        if (lower.includes(banned)) {
          issues.push({ path: `${path}.formula`, message: `Formula may not reference "${banned}"` });
        }
      }
      break;
    }

    case 'group': {
      if (condition.conditions.length === 0) {
        issues.push({ path: `${path}.conditions`, message: 'A group must contain at least one condition' });
      }
      condition.conditions.forEach((child, i) => walkCondition(child, `${path}.conditions[${i}]`, issues));
      break;
    }

    // candle_pattern, support_resistance, market_condition carry no further
    // semantic constraints beyond what Joi's shape validation already covers.
    default:
      break;
  }
}

/**
 * Runs the "Strategy Validator" stage of the pipeline: Strategy Builder ->
 * Strategy JSON -> **Strategy Validator** -> Strategy Engine. Joi already
 * confirmed the JSON is *shaped* correctly; this confirms it's *sane* —
 * indicator periods in range, cross-operators compare two real series,
 * MACD's fast/slow periods make sense, custom formulas don't reference
 * dangerous identifiers, risk figures are internally consistent, etc.
 */
export function validateStrategyDefinition(definition: StrategyDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];

  definition.entry.conditions.forEach((c, i) => walkCondition(c, `entry.conditions[${i}]`, issues));
  definition.exit.conditions.forEach((c, i) => walkCondition(c, `exit.conditions[${i}]`, issues));

  const { risk } = definition;
  if (risk.maxLossPerDay > risk.capitalAllocated) {
    issues.push({ path: 'risk.maxLossPerDay', message: 'maxLossPerDay cannot exceed capitalAllocated' });
  }
  if (risk.stopLoss.type === 'percent' && risk.stopLoss.value >= 100) {
    issues.push({ path: 'risk.stopLoss.value', message: 'Percent-based stop loss must be under 100%' });
  }
  if (risk.target.type === 'percent' && risk.target.value <= 0) {
    issues.push({ path: 'risk.target.value', message: 'Target must be a positive value' });
  }
  if (risk.positionSizing.method === 'percent_of_capital' && risk.positionSizing.value > 100) {
    issues.push({ path: 'risk.positionSizing.value', message: 'percent_of_capital cannot exceed 100' });
  }
  if (risk.trailingStopLoss?.enabled && risk.trailingStopLoss.type === 'percent' && risk.trailingStopLoss.value >= 100) {
    issues.push({ path: 'risk.trailingStopLoss.value', message: 'Percent-based trailing stop must be under 100%' });
  }

  return { valid: issues.length === 0, issues };
}

/** Same as validateStrategyDefinition but throws a 400 ApiError with all issues attached — used by create/update/activate. */
export function assertValidStrategyDefinition(definition: StrategyDefinition): void {
  const result = validateStrategyDefinition(definition);
  if (!result.valid) {
    throw ApiError.badRequest('Strategy definition failed validation', result.issues);
  }
}
