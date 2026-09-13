import type { ProtectedRequestHook } from "@x402/core/server";

/**
 * Try-before-you-pay: a request that opts in with the `X-Free-Tier` header gets up to N free
 * paid-route calls per client IP per UTC day; after that (or without the header) the normal x402
 * 402 challenge applies. The opt-in header keeps registry crawlers seeing a real 402, so listings
 * and trust scores are unaffected. Requests carrying a payment header are never counted.
 * In-memory (per instance) — good enough for a single Render instance.
 */

export const FREE_TIER_HEADER = "x-free-tier";

export interface FreeQuotaOptions {
  perDay: number;
  /** clock injection for tests */
  now?: () => number;
}

export interface FreeQuota {
  hook: ProtectedRequestHook;
  remaining(ip: string): number;
  /** test hook */
  reset(): void;
}

const MAX_TRACKED_IPS = 50_000;

function clientIp(getHeader: (name: string) => string | undefined): string {
  const xff = getHeader("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return getHeader("x-real-ip") ?? "unknown";
}

export function createFreeQuota(opts: FreeQuotaOptions): FreeQuota {
  const now = opts.now ?? Date.now;
  const counts = new Map<string, { day: string; used: number }>();

  const dayOf = (): string => new Date(now()).toISOString().slice(0, 10);

  const entry = (ip: string): { day: string; used: number } => {
    const day = dayOf();
    const cur = counts.get(ip);
    if (cur && cur.day === day) return cur;
    if (counts.size >= MAX_TRACKED_IPS) counts.clear();
    const fresh = { day, used: 0 };
    counts.set(ip, fresh);
    return fresh;
  };

  const hook: ProtectedRequestHook = async (context) => {
    if (opts.perDay <= 0) return;
    if (context.paymentHeader) return; // paying customer: let x402 handle it
    if (!context.adapter.getHeader(FREE_TIER_HEADER)) return; // no opt-in → 402 as usual
    const e = entry(clientIp((n) => context.adapter.getHeader(n)));
    if (e.used >= opts.perDay) return; // quota exhausted → 402
    e.used += 1;
    return { grantAccess: true };
  };

  return {
    hook,
    remaining: (ip) => Math.max(0, opts.perDay - entry(ip).used),
    reset: () => counts.clear(),
  };
}
