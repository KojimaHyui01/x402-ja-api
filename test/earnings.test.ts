import { beforeEach, describe, expect, it } from "vitest";
import { clearEarningsCache, fetchEarnings, summarize, type Receipt } from "../src/lib/earnings.js";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const ADDR = "0xA13c95b0a02F7255ddCfab86B2a22f6D6f6F9263";

const receipts: Receipt[] = [
  { at: "2026-09-13T09:00:00.000000Z", usdc: 0.02, from: "0xaaa", tx: "0x1" },
  { at: "2026-09-12T09:00:00.000000Z", usdc: 0.005, from: "0xbbb", tx: "0x2" },
  { at: "2026-09-01T09:00:00.000000Z", usdc: 0.03, from: "0xaaa", tx: "0x3" },
  { at: "2026-08-01T09:00:00.000000Z", usdc: 1, from: "0xccc", tx: "0x4" },
];

beforeEach(() => clearEarningsCache());

describe("summarize", () => {
  it("computes totals, windows, payers and per-day buckets", () => {
    const e = summarize(ADDR, receipts, 1.055, false, NOW);
    expect(e.totalUsdc).toBe(1.055);
    expect(e.count).toBe(4);
    expect(e.payers).toBe(3);
    expect(e.todayUsdc).toBe(0.02);
    expect(e.last7dUsdc).toBe(0.025);
    expect(e.last30dUsdc).toBe(0.055);
    expect(e.byDay[0]).toEqual({ day: "2026-09-13", usdc: 0.02, count: 1 });
    expect(e.latest[0]?.tx).toBe("0x1");
    expect(e.balanceUsdc).toBe(1.055);
  });
  it("handles zero receipts", () => {
    const e = summarize(ADDR, [], 0, false, NOW);
    expect(e.totalUsdc).toBe(0);
    expect(e.latest).toEqual([]);
  });
});

describe("fetchEarnings (Blockscout paging)", () => {
  it("pages through token-transfers and reads the USDC balance", async () => {
    const calls: string[] = [];
    const fake = async (url: string) => {
      calls.push(url);
      if (url.includes("/token-balances")) {
        return new Response(JSON.stringify([{ token: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: "6" }, value: "25000" }]), { status: 200 });
      }
      const page2 = url.includes("block_number=");
      const items = page2
        ? [{ timestamp: "2026-09-01T00:00:00.000000Z", transaction_hash: "0x3", from: { hash: "0xaaa" }, total: { value: "5000", decimals: "6" } }]
        : [{ timestamp: "2026-09-13T00:00:00.000000Z", transaction_hash: "0x1", from: { hash: "0xbbb" }, total: { value: "20000", decimals: "6" } }];
      return new Response(JSON.stringify({ items, next_page_params: page2 ? null : { block_number: 1, index: 0 } }), { status: 200 });
    };
    const e = await fetchEarnings(ADDR, fake, NOW);
    expect(e.count).toBe(2);
    expect(e.totalUsdc).toBe(0.025);
    expect(e.balanceUsdc).toBe(0.025);
    expect(e.truncated).toBe(false);
    expect(calls.filter((c) => c.includes("token-transfers")).length).toBe(2);
    // cached
    await fetchEarnings(ADDR, fake, NOW + 1000);
    expect(calls.filter((c) => c.includes("token-transfers")).length).toBe(2);
  });
});
