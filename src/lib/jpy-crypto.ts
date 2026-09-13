/**
 * JPY crypto market snapshot: prices on the major Japanese exchanges, a USD reference,
 * the USD/JPY rate, and the resulting "JPY premium" (how much more/less BTC costs in Japan).
 * All sources are public, unauthenticated endpoints. Results are cached briefly.
 */

export type Symbol = "BTC" | "ETH" | "XRP";
export const SYMBOLS: readonly Symbol[] = ["BTC", "ETH", "XRP"];

export interface ExchangeQuote {
  exchange: "bitflyer" | "coincheck" | "gmo" | "bitbank";
  pair: string;
  last: number;
  bid: number | null;
  ask: number | null;
  volume24h: number | null;
  timestamp: string;
}

export interface JpySnapshot {
  symbol: Symbol;
  asOf: string;
  jpy: {
    quotes: readonly ExchangeQuote[];
    median: number;
    min: number;
    max: number;
    /** (max - min) / median, as a fraction */
    dispersion: number;
  };
  usd: { price: number; source: string } | null;
  fx: { usdJpy: number; source: string; asOf: string } | null;
  /** crypto-implied USD/JPY = median JPY price / USD price */
  impliedUsdJpy: number | null;
  /** JPY price converted to USD vs. the USD reference, as a fraction (0.012 = +1.2%) */
  premium: number | null;
  errors: readonly string[];
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class CryptoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoInputError";
  }
}

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}

const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 10_000;

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { "User-Agent": "x402-ja-api/0.1", Accept: "application/json" } });
    if (!res.ok) throw new UpstreamError(`${new URL(url).host} responded ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

type Source = (f: FetchLike, s: Symbol) => Promise<ExchangeQuote>;

const bitflyer: Source = async (f, s) => {
  const d = (await getJson(f, `https://api.bitflyer.com/v1/ticker?product_code=${s}_JPY`)) as Record<string, unknown>;
  const last = num(d.ltp);
  if (last === null) throw new UpstreamError("bitflyer: no ltp");
  return { exchange: "bitflyer", pair: `${s}_JPY`, last, bid: num(d.best_bid), ask: num(d.best_ask), volume24h: num(d.volume), timestamp: String(d.timestamp) };
};

const coincheck: Source = async (f, s) => {
  const d = (await getJson(f, `https://coincheck.com/api/ticker?pair=${s.toLowerCase()}_jpy`)) as Record<string, unknown>;
  const last = num(d.last);
  if (last === null) throw new UpstreamError("coincheck: no last");
  return { exchange: "coincheck", pair: `${s.toLowerCase()}_jpy`, last, bid: num(d.bid), ask: num(d.ask), volume24h: num(d.volume), timestamp: new Date(Number(d.timestamp) * 1000).toISOString() };
};

const gmo: Source = async (f, s) => {
  const d = (await getJson(f, `https://api.coin.z.com/public/v1/ticker?symbol=${s}`)) as { data?: Record<string, unknown>[] };
  const row = d.data?.[0];
  const last = num(row?.last);
  if (!row || last === null) throw new UpstreamError("gmo: no data");
  return { exchange: "gmo", pair: s, last, bid: num(row.bid), ask: num(row.ask), volume24h: num(row.volume), timestamp: String(row.timestamp) };
};

const bitbank: Source = async (f, s) => {
  const d = (await getJson(f, `https://public.bitbank.cc/${s.toLowerCase()}_jpy/ticker`)) as { data?: Record<string, unknown> };
  const row = d.data;
  const last = num(row?.last);
  if (!row || last === null) throw new UpstreamError("bitbank: no data");
  return { exchange: "bitbank", pair: `${s.toLowerCase()}_jpy`, last, bid: num(row.buy), ask: num(row.sell), volume24h: num(row.vol), timestamp: new Date(Number(row.timestamp)).toISOString() };
};

const SOURCES: readonly Source[] = [bitflyer, coincheck, gmo, bitbank];

async function usdReference(f: FetchLike, s: Symbol): Promise<{ price: number; source: string }> {
  try {
    const d = (await getJson(f, `https://api.coinbase.com/v2/prices/${s}-USD/spot`)) as { data?: { amount?: string } };
    const p = num(d.data?.amount);
    if (p !== null) return { price: p, source: "coinbase" };
  } catch {
    // fall through to Kraken
  }
  const pair = s === "BTC" ? "XBTUSD" : `${s}USD`;
  const k = (await getJson(f, `https://api.kraken.com/0/public/Ticker?pair=${pair}`)) as { result?: Record<string, { c?: string[] }> };
  const first = Object.values(k.result ?? {})[0];
  const p = num(first?.c?.[0]);
  if (p === null) throw new UpstreamError("kraken: no price");
  return { price: p, source: "kraken" };
}

async function usdJpy(f: FetchLike): Promise<{ usdJpy: number; source: string; asOf: string }> {
  try {
    const d = (await getJson(f, "https://open.er-api.com/v6/latest/USD")) as { rates?: { JPY?: number }; time_last_update_utc?: string };
    const r = num(d.rates?.JPY);
    if (r !== null) return { usdJpy: r, source: "open.er-api.com", asOf: d.time_last_update_utc ?? "" };
  } catch {
    // fall through
  }
  const d = (await getJson(f, "https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY")) as { rates?: { JPY?: number }; date?: string };
  const r = num(d.rates?.JPY);
  if (r === null) throw new UpstreamError("frankfurter: no rate");
  return { usdJpy: r, source: "frankfurter (ECB)", asOf: d.date ?? "" };
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round = (x: number, digits: number): number => Number(x.toFixed(digits));

const cache = new Map<Symbol, { at: number; value: JpySnapshot }>();

export function parseSymbol(input: string): Symbol {
  const s = input.toUpperCase();
  if (!(SYMBOLS as readonly string[]).includes(s)) throw new CryptoInputError(`symbol must be one of ${SYMBOLS.join(", ")}`);
  return s as Symbol;
}

/** Fetch a fresh snapshot (parallel, partial-failure tolerant). Cached for 10 s per symbol. */
export async function jpySnapshot(symbol: Symbol, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<JpySnapshot> {
  const cached = cache.get(symbol);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  const settled = await Promise.allSettled([...SOURCES.map((src) => src(fetchImpl, symbol)), usdReference(fetchImpl, symbol), usdJpy(fetchImpl)]);
  const errors: string[] = [];
  const quotes: ExchangeQuote[] = [];
  settled.slice(0, SOURCES.length).forEach((r) => {
    if (r.status === "fulfilled") quotes.push(r.value as ExchangeQuote);
    else errors.push(String((r.reason as Error).message ?? r.reason));
  });
  const usdR = settled[SOURCES.length]!;
  const fxR = settled[SOURCES.length + 1]!;
  const usd = usdR.status === "fulfilled" ? (usdR.value as { price: number; source: string }) : (errors.push(`usd: ${(usdR.reason as Error).message}`), null);
  const fx = fxR.status === "fulfilled" ? (fxR.value as { usdJpy: number; source: string; asOf: string }) : (errors.push(`fx: ${(fxR.reason as Error).message}`), null);

  if (quotes.length === 0) throw new UpstreamError(`no Japanese exchange responded: ${errors.join("; ")}`);
  const lasts = quotes.map((q) => q.last);
  const med = median(lasts);
  const min = Math.min(...lasts);
  const max = Math.max(...lasts);
  const implied = usd ? med / usd.price : null;
  const premium = usd && fx ? med / fx.usdJpy / usd.price - 1 : null;

  const value: JpySnapshot = {
    symbol,
    asOf: new Date(now).toISOString(),
    jpy: { quotes, median: med, min, max, dispersion: round((max - min) / med, 6) },
    usd,
    fx,
    impliedUsdJpy: implied === null ? null : round(implied, 4),
    premium: premium === null ? null : round(premium, 6),
    errors,
  };
  cache.set(symbol, { at: now, value });
  return value;
}

/** Test hook. */
export function clearJpyCache(): void {
  cache.clear();
}
