import { ApiError } from '../../../utils/ApiError';

/**
 * Zerodha (instrument_token) and Dhan (securityId) both require a
 * broker-internal numeric/string id instead of a plain trading symbol for
 * historical-data and order-placement calls. Both publish a downloadable
 * instrument/scrip master (CSV) that maps tradingsymbol -> that id.
 *
 * This module downloads + parses those masters on first use and caches the
 * result in memory (per process) for a bounded TTL, so a backtest that
 * resolves dozens of symbols doesn't re-download a multi-MB CSV per call.
 */

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // instrument masters are published ~daily

interface CacheEntry<T> {
  fetchedAt: number;
  data: T;
}

/** Minimal CSV parser: no quoted-comma fields in these particular masters, so a plain split is fine and avoids pulling in a CSV dependency. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return rows;
}

// ─────────────────────────── Zerodha instrument tokens ───────────────────────────

let zerodhaCache: CacheEntry<Map<string, number>> | null = null;

/**
 * Zerodha's per-exchange CSV dump: GET /instruments/:exchange (no auth needed,
 * but Kite still requires the standard auth headers on every call in practice —
 * callers pass their own fetch/auth via `fetchCsv`).
 * Columns include: instrument_token, tradingsymbol, exchange, ...
 */
export async function resolveZerodhaInstrumentToken(
  exchange: string,
  tradingSymbol: string,
  fetchCsv: (exchange: string) => Promise<string>,
): Promise<number> {
  const key = `${exchange}:${tradingSymbol}`.toUpperCase();

  if (!zerodhaCache || Date.now() - zerodhaCache.fetchedAt > CACHE_TTL_MS) {
    const map = new Map<string, number>();
    // Zerodha's dump is segmented by exchange; NFO/BFO/CDS/MCX all differ from NSE/BSE.
    const exchangesToLoad = Array.from(new Set(['NSE', 'BSE', 'NFO', 'BFO', 'CDS', 'MCX', exchange.toUpperCase()]));
    for (const ex of exchangesToLoad) {
      try {
        const csv = await fetchCsv(ex);
        for (const row of parseCsv(csv)) {
          if (!row.instrument_token || !row.tradingsymbol) continue;
          map.set(`${(row.exchange || ex).toUpperCase()}:${row.tradingsymbol.toUpperCase()}`, Number(row.instrument_token));
        }
      } catch {
        // A given segment failing to load shouldn't block resolution for the others.
      }
    }
    zerodhaCache = { fetchedAt: Date.now(), data: map };
  }

  const token = zerodhaCache.data.get(key);
  if (!token) {
    throw ApiError.badRequest(`Could not resolve Zerodha instrument_token for ${exchange}:${tradingSymbol}`);
  }
  return token;
}

// ─────────────────────────── Dhan security IDs ───────────────────────────

export interface DhanInstrument {
  securityId: string;
  exchangeSegment: string; // e.g. NSE_EQ, NSE_FNO, BSE_EQ, MCX_COMM
}

let dhanCache: CacheEntry<Map<string, DhanInstrument>> | null = null;

/** Maps our platform's plain exchange string (NSE/BSE/NFO/BFO/MCX/CDS) + segment to Dhan's exchangeSegment enum. */
export function toDhanExchangeSegment(exchange: string, segment?: string): string {
  const ex = exchange.toUpperCase();
  if (ex === 'NFO') return 'NSE_FNO';
  if (ex === 'BFO') return 'BSE_FNO';
  if (ex === 'MCX') return 'MCX_COMM';
  if (ex === 'CDS') return 'NSE_CURRENCY';
  if (ex === 'BCD') return 'BSE_CURRENCY';
  if (ex === 'BSE') return segment === 'fno' ? 'BSE_FNO' : 'BSE_EQ';
  return segment === 'fno' ? 'NSE_FNO' : 'NSE_EQ';
}

/**
 * Dhan's compact scrip master: https://images.dhan.co/api-data/api-scrip-master.csv
 * Columns (compact): SEM_EXM_EXCH_ID, SEM_SEGMENT, SEM_SMST_SECURITY_ID, SEM_TRADING_SYMBOL, ...
 */
export async function resolveDhanSecurityId(
  exchange: string,
  tradingSymbol: string,
  segment: string | undefined,
  fetchCsv: () => Promise<string>,
): Promise<DhanInstrument> {
  const targetSegment = toDhanExchangeSegment(exchange, segment);
  const key = `${targetSegment}:${tradingSymbol}`.toUpperCase();

  if (!dhanCache || Date.now() - dhanCache.fetchedAt > CACHE_TTL_MS) {
    const map = new Map<string, DhanInstrument>();
    const csv = await fetchCsv();
    for (const row of parseCsv(csv)) {
      const exchId = row.SEM_EXM_EXCH_ID || row.EXCH_ID;
      const segCode = row.SEM_SEGMENT || row.SEGMENT;
      const securityId = row.SEM_SMST_SECURITY_ID || row.SECURITY_ID;
      const symbol = row.SEM_TRADING_SYMBOL || row.SYMBOL_NAME;
      if (!exchId || !securityId || !symbol) continue;

      const segMap: Record<string, string> = { E: 'EQ', D: 'FNO', C: 'CURRENCY', M: 'COMM' };
      const exchangeSegment = `${exchId}_${segMap[segCode] || 'EQ'}`;
      map.set(`${exchangeSegment}:${symbol.toUpperCase()}`, { securityId, exchangeSegment });
    }
    dhanCache = { fetchedAt: Date.now(), data: map };
  }

  const found = dhanCache.data.get(key);
  if (!found) {
    throw ApiError.badRequest(`Could not resolve Dhan securityId for ${exchange}:${tradingSymbol}`);
  }
  return found;
}