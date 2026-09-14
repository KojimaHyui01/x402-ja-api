import request from "supertest";
import { describe, expect, it } from "vitest";
import type { FacilitatorClient } from "@x402/core/server";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { VisitorRecord } from "../src/lib/visitors.js";

/** Separating registry crawlers from someone actually evaluating the API. */

const STATS_TOKEN = "test-stats-token-0123456789";

const cfg = loadConfig({
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  X402_NETWORK: "base-sepolia",
  PUBLIC_BASE_URL: "https://example.test",
  SERVICE_NAME: "ja-normalize-test",
  STATS_TOKEN,
  CLIENT_ID_SALT: "fixed-test-salt",
});

const stubFacilitator: FacilitatorClient = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
    extensions: [],
    signers: {},
  }),
  verify: async () => ({ isValid: false, invalidReason: "stub" }),
  settle: async () => ({ success: false, errorReason: "stub", transaction: "", network: "eip155:84532" }),
};

async function visitorsOf(app: ReturnType<typeof createApp>): Promise<readonly VisitorRecord[]> {
  const r = await request(app).get("/stats?format=json").auth(STATS_TOKEN, { type: "bearer" });
  return r.body.visitors.clients as readonly VisitorRecord[];
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

describe("visitor classification", () => {
  it("labels a client by how it identifies and behaves", async () => {
    const app = createApp(cfg, { paywall: false });
    const call = (ip: string, ua: string, path = "/llms.txt") =>
      request(app).get(path).set("X-Forwarded-For", ip).set("User-Agent", ua);

    await call("203.0.113.1", "SomeRegistryBot/1.0");
    await call("203.0.113.2", "curl/8.4.0");
    await call("203.0.113.3", BROWSER_UA);
    await request(app).get("/llms.txt").set("X-Forwarded-For", "203.0.113.4").set("User-Agent", "");

    const byClass = Object.fromEntries((await visitorsOf(app)).map((c) => [c.class, c]));
    expect(byClass.crawler).toBeDefined();
    expect(byClass.tool).toBeDefined();
    expect(byClass.browser).toBeDefined();
    // A client that sends no User-Agent at all is automation too, so both land in crawler.
    expect((await visitorsOf(app)).filter((c) => c.class === "crawler")).toHaveLength(2);
  }, 30_000);

  it("treats the documented X-Free-Tier header as evidence of a real evaluator", async () => {
    const app = createApp(cfg, { paywall: true, facilitator: stubFacilitator, freeQuotaPerDay: 5 });
    // Same suspicious user agent as a bot — the header is what distinguishes them.
    await request(app)
      .get("/v1/jp/holidays?year=2026")
      .set("X-Forwarded-For", "198.51.100.1")
      .set("User-Agent", "python-requests/2.31.0")
      .set("X-Free-Tier", "1");

    const client = (await visitorsOf(app))[0]!;
    expect(client.class).toBe("docs-reader");
    expect(client.free).toBe(1);
  }, 30_000);

  it("calls a sweep across many endpoints a crawler whatever the user agent claims", async () => {
    const app = createApp(cfg, { paywall: true, facilitator: stubFacilitator, freeQuotaPerDay: 0 });
    const paths = [
      "/v1/jp/holidays?year=2026",
      "/v1/jp/business-day?date=2026-01-05",
      "/v1/jp/name/romaji?kana=%E3%81%95%E3%81%A8%E3%81%86",
      "/v1/jp/bank/lookup?bank=0001",
      "/v1/holidays?country=DE&year=2026",
      "/v1/business-day?country=DE&date=2026-12-24",
      "/v1/jp/crypto/ticker?symbol=BTC",
    ];
    for (const p of paths) {
      await request(app).get(p).set("X-Forwarded-For", "198.51.100.9").set("User-Agent", BROWSER_UA);
    }

    const client = (await visitorsOf(app))[0]!;
    expect(client.class).toBe("crawler");
    expect(client.routes.length).toBeGreaterThanOrEqual(6);
    expect(client.challenged).toBe(paths.length);
  }, 30_000);

  it("gives each address its own id and keeps one address stable", async () => {
    const app = createApp(cfg, { paywall: false });
    await request(app).get("/llms.txt").set("X-Forwarded-For", "203.0.113.77");
    await request(app).get("/openapi.json").set("X-Forwarded-For", "203.0.113.77");
    await request(app).get("/llms.txt").set("X-Forwarded-For", "203.0.113.78");

    const clients = await visitorsOf(app);
    expect(clients).toHaveLength(2);
    const busiest = clients.find((c) => c.requests === 2);
    expect(busiest).toBeDefined();
    expect(busiest!.routes).toHaveLength(2);
    // Addresses are never stored, only a salted digest.
    expect(JSON.stringify(clients)).not.toContain("203.0.113.77");
  }, 30_000);

  it("ignores health checks and the operator's own dashboard", async () => {
    const app = createApp(cfg, { paywall: false });
    await request(app).get("/health").set("X-Forwarded-For", "203.0.113.90");
    await request(app).get("/stats?format=json").set("X-Forwarded-For", "203.0.113.90").auth(STATS_TOKEN, { type: "bearer" });

    expect(await visitorsOf(app)).toHaveLength(0);
  }, 30_000);
});
