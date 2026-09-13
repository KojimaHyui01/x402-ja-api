import type { x402ResourceServer } from "@x402/core/server";
import type { ProtectedRequestHook } from "@x402/core/server";

/**
 * In-process counters since boot: per-route free-tier grants, 402 challenges, and settled payments
 * (count + micro-USDC). Not persistent — the on-chain view in lib/earnings.ts is the source of truth
 * for money; this shows *which* endpoints are being used and how (free vs paid vs bounced).
 */

export interface RouteCounters {
  free: number;
  challenged: number;
  paid: number;
  paidMicroUsdc: number;
}

export interface MetricsSnapshot {
  since: string;
  totals: RouteCounters;
  routes: Record<string, RouteCounters>;
  recentPayments: readonly { at: string; route: string; usdc: number; payer: string | null; tx: string }[];
}

const MAX_RECENT = 25;

function blank(): RouteCounters {
  return { free: 0, challenged: 0, paid: 0, paidMicroUsdc: 0 };
}

export class Metrics {
  private readonly since = new Date().toISOString();
  private readonly routes = new Map<string, RouteCounters>();
  private readonly recent: MetricsSnapshot["recentPayments"][number][] = [];

  private bucket(route: string): RouteCounters {
    const b = this.routes.get(route) ?? blank();
    this.routes.set(route, b);
    return b;
  }

  /** Wrap the free-quota hook so grants and challenges are counted. */
  observeProtectedRequests(inner: ProtectedRequestHook): ProtectedRequestHook {
    return async (context, routeConfig) => {
      const result = await inner(context, routeConfig);
      const route = `${context.method.toUpperCase()} ${context.routePattern ?? context.path}`;
      if (result && "grantAccess" in result) this.bucket(route).free += 1;
      else if (!context.paymentHeader) this.bucket(route).challenged += 1;
      return result;
    };
  }

  /** Count successful settlements. */
  attachTo(server: x402ResourceServer): void {
    server.onAfterSettle(async (ctx) => {
      if (!ctx.result.success) return;
      const micro = Number(ctx.result.amount ?? ctx.requirements.amount);
      const route = routeFromResource(ctx);
      const b = this.bucket(route);
      b.paid += 1;
      b.paidMicroUsdc += Number.isFinite(micro) ? micro : 0;
      this.recent.unshift({
        at: new Date().toISOString(),
        route,
        usdc: Number.isFinite(micro) ? micro / 1e6 : 0,
        payer: ctx.result.payer ?? null,
        tx: ctx.result.transaction,
      });
      if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT;
    });
  }

  snapshot(): MetricsSnapshot {
    const totals = blank();
    const routes: Record<string, RouteCounters> = {};
    for (const [route, c] of [...this.routes.entries()].sort()) {
      routes[route] = { ...c };
      totals.free += c.free;
      totals.challenged += c.challenged;
      totals.paid += c.paid;
      totals.paidMicroUsdc += c.paidMicroUsdc;
    }
    return { since: this.since, totals, routes, recentPayments: [...this.recent] };
  }
}

function routeFromResource(ctx: { paymentPayload: { readonly resource?: { readonly url?: string } } }): string {
  const url = ctx.paymentPayload.resource?.url;
  if (!url) return "unknown";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
