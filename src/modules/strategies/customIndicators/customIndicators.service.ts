import { CustomIndicator } from '../../../models';
import { ApiError } from '../../../utils/ApiError';
import { PaginationParams, buildPaginationMeta } from '../../../utils/pagination';
import { Candle } from '../../brokers/adapters/brokerAdapter.interface';
import { executeIndicator, IndicatorData } from '../sandbox/sandboxService.client';

export interface CustomIndicatorInput {
  name: string;
  description?: string | null;
  code: string;
  params?: Record<string, number | string>;
}

async function getOwnedIndicator(userId: string, id: string): Promise<CustomIndicator> {
  const indicator = await CustomIndicator.findOne({ where: { id, userId } });
  if (!indicator) throw ApiError.notFound('Custom indicator not found');
  return indicator;
}

export async function listCustomIndicators(userId: string, pagination: PaginationParams) {
  const { count, rows } = await CustomIndicator.findAndCountAll({
    where: { userId },
    order: [['updatedAt', 'DESC']],
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return { rows, meta: buildPaginationMeta(count, pagination.page, pagination.limit) };
}

export async function getCustomIndicator(userId: string, id: string) {
  return getOwnedIndicator(userId, id);
}

function candlesToIndicatorData(candles: Candle[]): IndicatorData {
  return {
    timestamp: candles.map((c) => c.timestamp),
    open: candles.map((c) => c.open),
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    volume: candles.map((c) => c.volume ?? 0),
  };
}

/** Small synthetic OHLCV series (a gentle sine-wave-ish walk, not random noise) used only to smoke-test that an indicator's code compiles and returns the right shape — not a substitute for testing against real data, see `testCustomIndicator` below. */
function syntheticSampleData(length = 60): IndicatorData {
  const timestamp: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const close: number[] = [];
  const volume: number[] = [];
  let price = 100;
  for (let i = 0; i < length; i++) {
    price += Math.sin(i / 5) * 0.8 + 0.05;
    timestamp.push(i * 60_000);
    open.push(price);
    high.push(price + 0.6);
    low.push(price - 0.6);
    close.push(price + 0.1);
    volume.push(1000 + (i % 7) * 100);
  }
  return { timestamp, open, high, low, close, volume };
}

/**
 * Runs the indicator's `calculate()` against a small synthetic series —
 * the cheap "does this even compile and return the right shape" check used
 * when saving (mirrors assertValidPythonStrategy's role for strategies).
 */
async function assertValidIndicatorCode(code: string, params: Record<string, number | string>): Promise<void> {
  const result = await executeIndicator(code, syntheticSampleData(), params);
  if (!result.ok) {
    throw ApiError.badRequest('Indicator code failed validation', [{ path: 'code', message: result.error ?? 'Unknown error' }]);
  }
}

export async function createCustomIndicator(userId: string, input: CustomIndicatorInput) {
  await assertValidIndicatorCode(input.code, input.params ?? {});
  const existing = await CustomIndicator.findOne({ where: { userId, name: input.name } });
  if (existing) {
    throw ApiError.badRequest(`You already have a custom indicator named "${input.name}"`);
  }
  return CustomIndicator.create({
    userId,
    name: input.name,
    description: input.description ?? null,
    code: input.code,
    params: input.params ?? {},
    lastValidatedAt: new Date(),
  });
}

export async function updateCustomIndicator(userId: string, id: string, input: Partial<CustomIndicatorInput>) {
  const indicator = await getOwnedIndicator(userId, id);
  const nextCode = input.code ?? indicator.code;
  const nextParams = input.params ?? indicator.params;

  if (input.code !== undefined || input.params !== undefined) {
    await assertValidIndicatorCode(nextCode, nextParams);
    indicator.lastValidatedAt = new Date();
  }
  if (input.name !== undefined) indicator.name = input.name;
  if (input.description !== undefined) indicator.description = input.description;
  indicator.code = nextCode;
  indicator.params = nextParams;
  await indicator.save();
  return indicator;
}

export async function deleteCustomIndicator(userId: string, id: string) {
  const indicator = await getOwnedIndicator(userId, id);
  await indicator.destroy();
  return { id: indicator.id };
}

/**
 * Authoring-time check: validates code (without saving) against either the
 * synthetic sample series or, if `candles` is given, real historical data —
 * this is what the Custom Indicator Studio's "Validate"/"Run Indicator
 * Test" buttons call. Returns the computed series plus current/previous
 * values so the UI can chart it and show "Current Value / Previous /
 * Change" the way the design doc describes.
 */
export async function testCustomIndicatorCode(code: string, params: Record<string, number | string>, candles?: Candle[]) {
  const data = candles && candles.length > 0 ? candlesToIndicatorData(candles) : syntheticSampleData();
  const result = await executeIndicator(code, data, params);
  if (!result.ok) {
    throw ApiError.badRequest('Indicator code failed to run', [{ path: 'code', message: result.error ?? 'Unknown error' }]);
  }
  const series = result.series;
  const lastDefined = [...series].reverse().find((v) => v !== null) ?? null;
  const lastIndex = series.length - 1 - [...series].reverse().findIndex((v) => v !== null);
  const previousDefined = lastIndex > 0 ? series.slice(0, lastIndex).reverse().find((v) => v !== null) ?? null : null;

  return {
    timestamps: data.timestamp,
    series,
    usedSyntheticData: !candles || candles.length === 0,
    currentValue: lastDefined,
    previousValue: previousDefined,
    change: lastDefined !== null && previousDefined !== null ? lastDefined - previousDefined : null,
  };
}

/**
 * The bridge from "a saved custom indicator" to "a strategy's ctx.custom()
 * calls" — scans `pythonCode` for `ctx.custom("name")` / `ctx.custom('name')`
 * references, resolves each referenced name against this user's saved
 * indicators (silently skipping ones that don't resolve — the strategy
 * sandbox itself already handles an unknown name gracefully by returning
 * None from ctx.custom), computes each one's series once over the whole
 * `candles` range, and returns the customSeries map executeStrategy expects.
 *
 * Deliberately regex-based rather than a real AST parse — user strategy
 * code is never executed here, only pattern-matched for indicator *names*,
 * so a false negative just means that indicator's ctx.custom() calls
 * return None (same as an unrecognized name) rather than a real signal
 * being silently dropped; the strategy still runs.
 */
export async function resolveCustomSeriesForCode(
  userId: string,
  pythonCode: string,
  candles: Candle[],
): Promise<Record<string, (number | null)[]>> {
  const names = new Set<string>();
  const pattern = /ctx\.custom\(\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(pythonCode)) !== null) {
    names.add(match[1]);
  }
  if (names.size === 0) return {};

  const indicators = await CustomIndicator.findAll({ where: { userId, name: Array.from(names) } });
  const data = candlesToIndicatorData(candles);

  const entries = await Promise.all(
    indicators.map(async (indicator) => {
      const result = await executeIndicator(indicator.code, data, indicator.params);
      return [indicator.name, result.ok ? result.series : new Array(candles.length).fill(null)] as const;
    }),
  );

  return Object.fromEntries(entries);
}
