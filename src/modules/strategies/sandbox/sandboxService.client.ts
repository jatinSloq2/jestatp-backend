import { env } from '../../../config/env';
import { ApiError } from '../../../utils/ApiError';

/**
 * The ONLY place in Node that talks to jestatp-sandbox-service. Mirrors
 * brokers/brokerService.client.ts's request pattern deliberately — same
 * internal-token auth, same error-shape handling — so anyone who already
 * knows one knows the other.
 */

export interface SandboxBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SandboxPosition {
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  entryTimestamp: number;
}

export interface SandboxSignal {
  timestamp: number;
  action: 'buy' | 'sell' | 'exit';
  quantity: number | null;
  note: string;
}

export interface ExecuteStrategyParams {
  code: string;
  bars: SandboxBar[];
  mode: 'backtest' | 'live';
  state?: Record<string, unknown>;
  params?: Record<string, unknown>;
  position?: SandboxPosition | null;
  /** backtest only: bars required before the first on_bar() call (see sandbox-service's ExecuteRequest.warmup). */
  warmup?: number;
  /** name -> value-per-bar, same length/order as `bars` — see customIndicators.service.ts, which precomputes each referenced custom indicator's series once before the strategy run so ctx.custom("name") is a plain lookup inside the sandbox. */
  customSeries?: Record<string, (number | null)[]>;
}

export interface ExecuteStrategyResult {
  ok: boolean;
  signals: SandboxSignal[];
  state: Record<string, unknown>;
  logs: string[];
  error: string | null;
  traceback: string | null;
}

function sandboxServiceUrl(path: string): string {
  return new URL(path, env.sandboxService.url).toString();
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(sandboxServiceUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': env.sandboxService.internalToken },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }

  if (!response.ok) {
    const detail = (json as { detail?: string } | undefined)?.detail;
    throw new ApiError(response.status >= 500 ? 502 : 400, `Sandbox service error (${response.status}): ${detail ?? response.statusText}`, json);
  }

  return json as T;
}

/**
 * Runs a user's `on_bar(ctx)` Python strategy against `bars` inside the
 * sandbox. Callers are responsible for interpreting `result.signals` (see
 * pythonBacktestEngine.ts for backtest, the live-strategy worker for
 * live/paper) — this client only knows how to reach the service, not how
 * to turn signals into trades.
 */
export function executeStrategy(params: ExecuteStrategyParams): Promise<ExecuteStrategyResult> {
  return post('/execute', {
    code: params.code,
    bars: params.bars,
    mode: params.mode,
    state: params.state ?? {},
    params: params.params ?? {},
    position: params.position ?? null,
    warmup: params.warmup ?? 1,
    customSeries: params.customSeries ?? {},
  });
}

/** Cheap syntax/shape check used when a user saves a python strategy — see strategy.service.ts. */
export function validateStrategyCode(code: string): Promise<{ ok: boolean; error: string | null }> {
  return post('/validate', { code });
}

export interface IndicatorData {
  timestamp: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export interface ExecuteIndicatorResult {
  ok: boolean;
  series: (number | null)[];
  error: string | null;
  traceback: string | null;
}

/**
 * Runs a custom indicator's `calculate(data, params)` once over `data`
 * (see sandbox-service's app/sdk/indicator_contract.py). Used both by
 * customIndicators.service.ts's validate/preview endpoints (authoring
 * time) and, precomputed once per backtest/live run, to build the
 * `customSeries` map passed into `executeStrategy` above.
 */
export function executeIndicator(code: string, data: IndicatorData, params: Record<string, unknown> = {}): Promise<ExecuteIndicatorResult> {
  return post('/execute-indicator', { code, data, params });
}
