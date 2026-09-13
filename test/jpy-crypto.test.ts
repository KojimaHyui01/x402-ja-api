import { beforeEach, describe, expect, it } from "vitest";
import { CryptoInputError, UpstreamError, clearJpyCache, jpySnapshot, parseSymbol } from "../src/lib/jpy-crypto.js";

/** Fake upstreams keyed by host. */
function fakeFetch(overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const routes: Record<string, () => Response> = {
    "api.bitflyer.com": () => json({ ltp: 11873368, best_bid: 11873000, best_ask: 11874000, volume: 1000, timestamp: "2026-09-13T05:52:14.97" }),
    "coincheck.com": () => json({ last: 11876006, bid: 11875000, ask: 11877000, volume: 500, timestamp: 1789278730 }),
    "api.coin.z.com": () => json({ status: 0, data: [{ last: "11880960", bid: "11881367", ask: "11881519", volume: "29.7", timestamp: "2026-09-13T05:52:14.003Z" }] }),
    "public.bitbank.cc": () => json({ success: 1, data: { last: "11884688", buy: "11884688", sell: "11884689", vol: "20.9", timestamp: 1789278734753 } }),
    "api.coinbase.com": () => json({ data: { amount: "77280", base: "BTC", currency: "USD" } }),
    "api.kraken.com": () => json({ error: [], result: { XXBTZUSD: { c: ["77296.3", "0.1"] } } }),
    "open.er-api.com": () => json({ result: "success", rates: { JPY: 153.8 }, time_last_update_utc: "Sun, 13 Sep 2026 00:02:31 +0000" }),
    "api.frankfurter.dev": () => json({ rates: { JPY: 153.5 }, date: "2026-09-12" }),
    ...overrides,
  };
  const f = async (url: string) => {
    calls.push(url);
    const host = new URL(url).host;
    const r = routes[host];
    if (!r) throw new Error(`unexpected host ${host}`);
    return r();
  };
  return { f, calls };
}

beforeEach(() => clearJpyCache());

describe("parseSymbol", () => {
  it("accepts BTC/ETH/XRP case-insensitively, rejects others", () => {
    expect(parseSymbol("btc")).toBe("BTC");
    expect(() => parseSymbol("DOGE")).toThrow(CryptoInputError);
  });
});

describe("jpySnapshot", () => {
  it("aggregates four exchanges, USD reference, FX and premium", async () => {
    const { f } = fakeFetch();
    const s = await jpySnapshot("BTC", f, 1_000_000);
    expect(s.jpy.quotes.map((q) => q.exchange).sort()).toEqual(["bitbank", "bitflyer", "coincheck", "gmo"]);
    expect(s.jpy.median).toBe((11876006 + 11880960) / 2);
    expect(s.usd).toEqual({ price: 77280, source: "coinbase" });
    expect(s.fx?.usdJpy).toBe(153.8);
    // premium = median / fx / usd - 1
    expect(s.premium).toBeCloseTo(s.jpy.median / 153.8 / 77280 - 1, 6);
    expect(s.impliedUsdJpy).toBeCloseTo(s.jpy.median / 77280, 3);
    expect(s.errors).toEqual([]);
  });

  it("tolerates a failing exchange and falls back to Kraken / frankfurter", async () => {
    const { f } = fakeFetch({
      "coincheck.com": () => new Response("down", { status: 503 }),
      "api.coinbase.com": () => new Response("nope", { status: 500 }),
      "open.er-api.com": () => new Response("nope", { status: 500 }),
    });
    const s = await jpySnapshot("BTC", f, 2_000_000);
    expect(s.jpy.quotes).toHaveLength(3);
    expect(s.usd?.source).toBe("kraken");
    expect(s.fx?.source).toMatch(/frankfurter/);
    expect(s.errors.some((e) => e.includes("coincheck"))).toBe(true);
  });

  it("returns partial data with premium=null when USD or FX is unavailable", async () => {
    const { f } = fakeFetch({
      "api.coinbase.com": () => new Response("x", { status: 500 }),
      "api.kraken.com": () => new Response("x", { status: 500 }),
    });
    const s = await jpySnapshot("ETH", f, 3_000_000);
    expect(s.usd).toBeNull();
    expect(s.premium).toBeNull();
    expect(s.jpy.quotes.length).toBe(4);
  });

  it("throws when no Japanese exchange responds", async () => {
    const down = () => new Response("x", { status: 500 });
    const { f } = fakeFetch({ "api.bitflyer.com": down, "coincheck.com": down, "api.coin.z.com": down, "public.bitbank.cc": down });
    await expect(jpySnapshot("BTC", f, 4_000_000)).rejects.toBeInstanceOf(UpstreamError);
  });

  it("caches for 10 seconds per symbol", async () => {
    const { f, calls } = fakeFetch();
    await jpySnapshot("BTC", f, 5_000_000);
    const n = calls.length;
    await jpySnapshot("BTC", f, 5_005_000);
    expect(calls.length).toBe(n);
    await jpySnapshot("BTC", f, 5_020_000);
    expect(calls.length).toBeGreaterThan(n);
  });
});
