/**
 * On-chain earnings: USDC transfers received by the payout wallet on Base, via Blockscout's free API
 * (no key). This is the source of truth for money; it also catches payments made while the server
 * was restarting. Cached briefly to stay polite to Blockscout.
 */

export interface Receipt {
  at: string;
  usdc: number;
  from: string;
  tx: string;
}

export interface Earnings {
  address: string;
  asOf: string;
  totalUsdc: number;
  count: number;
  payers: number;
  todayUsdc: number;
  last7dUsdc: number;
  last30dUsdc: number;
  byDay: readonly { day: string; usdc: number; count: number }[];
  latest: readonly Receipt[];
  balanceUsdc: number | null;
  /** true when more history exists than we paged through */
  truncated: boolean;
  source: string;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BLOCKSCOUT = "https://base.blockscout.com/api/v2";
const MAX_PAGES = 20; // 20 × 50 = 1,000 most recent receipts
const CACHE_TTL_MS = 60_000;
const DAY = 86_400_000;

interface BsTransfer {
  timestamp: string;
  transaction_hash: string;
  from: { hash: string };
  total: { value: string; decimals: string };
}

interface BsPage {
  items: BsTransfer[];
  next_page_params: Record<string, string | number> | null;
}

async function getJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "x402-ja-api/0.1" } });
  if (!res.ok) throw new Error(`blockscout ${res.status} for ${url}`);
  return (await res.json()) as T;
}

async function fetchReceipts(fetchImpl: FetchLike, address: string): Promise<{ receipts: Receipt[]; truncated: boolean }> {
  const receipts: Receipt[] = [];
  let params: Record<string, string | number> | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const qs = new URLSearchParams({ type: "ERC-20", filter: "to", token: USDC_BASE });
    for (const [k, v] of Object.entries(params ?? {})) qs.set(k, String(v));
    const data = await getJson<BsPage>(fetchImpl, `${BLOCKSCOUT}/addresses/${address}/token-transfers?${qs.toString()}`);
    for (const t of data.items) {
      const decimals = Number(t.total.decimals || "6");
      receipts.push({ at: t.timestamp, usdc: Number(t.total.value) / 10 ** decimals, from: t.from.hash, tx: t.transaction_hash });
    }
    if (!data.next_page_params) return { receipts, truncated: false };
    params = data.next_page_params;
  }
  return { receipts, truncated: true };
}

async function fetchBalance(fetchImpl: FetchLike, address: string): Promise<number | null> {
  try {
    const list = await getJson<{ token: { address: string; decimals: string }; value: string }[]>(
      fetchImpl,
      `${BLOCKSCOUT}/addresses/${address}/token-balances`,
    );
    const usdc = list.find((b) => b.token.address.toLowerCase() === USDC_BASE.toLowerCase());
    return usdc ? Number(usdc.value) / 10 ** Number(usdc.token.decimals || "6") : 0;
  } catch {
    return null;
  }
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

export function summarize(address: string, receipts: readonly Receipt[], balanceUsdc: number | null, truncated: boolean, now = Date.now()): Earnings {
  const sorted = [...receipts].sort((a, b) => b.at.localeCompare(a.at));
  const byDayMap = new Map<string, { usdc: number; count: number }>();
  let total = 0;
  let today = 0;
  let last7 = 0;
  let last30 = 0;
  const todayKey = new Date(now).toISOString().slice(0, 10);
  const payers = new Set<string>();
  for (const r of sorted) {
    total += r.usdc;
    payers.add(r.from.toLowerCase());
    const t = Date.parse(r.at);
    const day = r.at.slice(0, 10);
    if (day === todayKey) today += r.usdc;
    if (now - t <= 7 * DAY) last7 += r.usdc;
    if (now - t <= 30 * DAY) last30 += r.usdc;
    const d = byDayMap.get(day) ?? { usdc: 0, count: 0 };
    d.usdc += r.usdc;
    d.count += 1;
    byDayMap.set(day, d);
  }
  const byDay = [...byDayMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 31)
    .map(([day, d]) => ({ day, usdc: round6(d.usdc), count: d.count }));
  return {
    address,
    asOf: new Date(now).toISOString(),
    totalUsdc: round6(total),
    count: sorted.length,
    payers: payers.size,
    todayUsdc: round6(today),
    last7dUsdc: round6(last7),
    last30dUsdc: round6(last30),
    byDay,
    latest: sorted.slice(0, 20),
    balanceUsdc,
    truncated,
    source: "Blockscout (base.blockscout.com), USDC transfers to the payout address",
  };
}

let cache: { at: number; value: Earnings } | null = null;

export async function fetchEarnings(address: string, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<Earnings> {
  if (cache && now - cache.at < CACHE_TTL_MS && cache.value.address === address) return cache.value;
  const [{ receipts, truncated }, balance] = await Promise.all([fetchReceipts(fetchImpl, address), fetchBalance(fetchImpl, address)]);
  const value = summarize(address, receipts, balance, truncated, now);
  cache = { at: now, value };
  return value;
}

/** Test hook. */
export function clearEarningsCache(): void {
  cache = null;
}
