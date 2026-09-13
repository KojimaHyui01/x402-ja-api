import request from "supertest";
import { describe, expect, it } from "vitest";
import type { FacilitatorClient } from "@x402/core/server";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const TEST_ENV = {
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  X402_NETWORK: "base-sepolia",
  PUBLIC_BASE_URL: "https://example.test",
  SERVICE_NAME: "ja-normalize-test",
};

const cfg = loadConfig(TEST_ENV);

describe("loadConfig", () => {
  it("treats blank strings as unset (Render sends '' for empty env vars)", () => {
    const c = loadConfig({ ...TEST_ENV, HOJIN_APP_ID: "", CDP_API_KEY_ID: "   " });
    expect(c.HOJIN_APP_ID).toBeUndefined();
    expect(c.CDP_API_KEY_ID).toBeUndefined();
  });
  it("requires CDP keys on mainnet", () => {
    expect(() => loadConfig({ ...TEST_ENV, X402_NETWORK: "base" })).toThrow(/CDP_API_KEY_ID/);
  });
});

describe("discovery documents", () => {
  const app = createApp(cfg, { paywall: false });

  it("serves /health", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.network).toBe("eip155:84532");
    expect(r.body.endpoints).toBe(12);
  });

  it("serves an OpenAPI doc with x-payment-info on every operation", async () => {
    const r = await request(app).get("/openapi.json");
    expect(r.status).toBe(200);
    expect(r.body.openapi).toBe("3.1.0");
    expect(r.body["x-discovery"].ownershipProofs).toEqual([TEST_ENV.PAY_TO_ADDRESS]);
    const op = r.body.paths["/v1/address/normalize"].post;
    expect(op["x-payment-info"].price).toBe("$0.02");
    expect(op["x-payment-info"].payTo).toBe(TEST_ENV.PAY_TO_ADDRESS);
    expect(op.requestBody.content["application/json"].schema.required).toEqual(["address"]);
  });

  it("publishes a contact email and serves a favicon", async () => {
    const o = await request(app).get("/openapi.json");
    expect(o.body.info.contact.email).toBe("yux0115@gmail.com");
    const f = await request(app).get("/favicon.ico");
    expect(f.status).toBe(200);
    expect(f.headers["content-type"]).toMatch(/image\/x-icon/);
  });

  it("serves /.well-known/ai.txt for the x402Relay manifest scanner", async () => {
    const r = await request(app).get("/.well-known/ai.txt");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/plain/);
    expect(r.text).toContain("x402-endpoint: https://example.test");
    expect(r.text).toContain("x402-network: base-sepolia");
    expect(r.text).toContain("x402-price: 0.005");
    expect(r.text).toContain(`x402-pay-to: ${TEST_ENV.PAY_TO_ADDRESS}`);
  });

  it("serves /.well-known/x402 with absolute resource URLs and agent instructions", async () => {
    const r = await request(app).get("/.well-known/x402");
    expect(r.status).toBe(200);
    expect(r.body.resources).toContain("https://example.test/v1/text/normalize");
    expect(r.body.ownershipProofs).toEqual([TEST_ENV.PAY_TO_ADDRESS]);
    expect(r.body.instructions).toContain("GET /v1/business-day");
    expect(r.body.instructions).toContain("free calls per UTC day");
    const l = await request(app).get("/llms.txt");
    expect(l.status).toBe(200);
    expect(l.text).toContain("## Endpoints");
  });
});

describe("handlers (paywall disabled)", () => {
  const app = createApp(cfg, { paywall: false });

  it("POST /v1/text/normalize returns structured output", async () => {
    const r = await request(app)
      .post("/v1/text/normalize")
      .send({ text: "平成３１年４月３０日 ＴＥＬ ０９０－１２３４－５６７８" });
    expect(r.status).toBe(200);
    expect(r.body.normalized).toBe("2019-04-30 TEL 090-1234-5678");
    expect(r.body.phones[0].e164).toBe("+819012345678");
  });

  it("GET /v1/holidays and /v1/business-day work worldwide", async () => {
    const h = await request(app).get("/v1/holidays?country=de&year=2026&region=by&types=public");
    expect(h.status).toBe(200);
    expect(h.body.country).toBe("DE");
    expect(h.body.holidays[0]).toMatchObject({ date: "2026-01-01", name: "New Year's Day", type: "public" });
    expect((await request(app).get("/v1/holidays?country=XX&year=2026")).status).toBe(400);
    expect((await request(app).get("/v1/holidays?country=DE&year=2026&types=nope")).status).toBe(400);
    const b = await request(app).get("/v1/business-day?country=SA&date=2026-09-17&add=1");
    expect(b.body.result).toBe("2026-09-20");
    expect(b.body.weekend).toEqual([5, 6]);
    const w = await request(app).get("/v1/business-day?country=DE&date=2026-09-17&add=1&weekend=5,6");
    expect(w.body.result).toBe("2026-09-20");
  });

  it("GET /v1/holidays/countries is free reference data", async () => {
    const c = await request(app).get("/v1/holidays/countries");
    expect(c.status).toBe(200);
    expect(c.body.count).toBeGreaterThan(180);
    const r = await request(app).get("/v1/holidays/countries?country=US");
    expect(r.body.regions.length).toBeGreaterThan(50);
    expect((await request(app).get("/v1/holidays/countries?country=XX")).status).toBe(400);
  });

  it("GET /v1/jp/crypto/ticker validates the symbol", async () => {
    expect((await request(app).get("/v1/jp/crypto/ticker?symbol=DOGE")).status).toBe(400);
  });

  it("GET /v1/jp/holidays lists a year", async () => {
    const r = await request(app).get("/v1/jp/holidays?year=2026");
    expect(r.status).toBe(200);
    expect(r.body.year).toBe(2026);
    expect(r.body.holidays).toContainEqual({ date: "2026-09-22", name: "休日" });
    expect((await request(app).get("/v1/jp/holidays?year=1800")).status).toBe(400);
    expect((await request(app).get("/v1/jp/holidays")).status).toBe(400);
  });

  it("GET /v1/jp/business-day adds business days on the bank calendar", async () => {
    const r = await request(app).get("/v1/jp/business-day?date=2026-12-30&add=1&calendar=bank");
    expect(r.status).toBe(200);
    expect(r.body.isBusinessDay).toBe(true);
    expect(r.body.result).toBe("2027-01-04");
    expect(r.body.lastBusinessDayOfMonth).toBe("2026-12-30");
    expect((await request(app).get("/v1/jp/business-day?date=2026-02-30")).status).toBe(400);
    expect((await request(app).get("/v1/jp/business-day?calendar=lunar")).status).toBe(400);
  });

  it("GET /v1/jp/bank/resolve returns bank + branch + best", async () => {
    const r = await request(app).get("/v1/jp/bank/resolve?bank=%E3%81%BF%E3%81%9A%E3%81%BB%E9%8A%80%E8%A1%8C&branch=%E6%96%B0%E5%AE%BF%E6%94%AF%E5%BA%97");
    expect(r.status).toBe(200);
    expect(r.body.best).toEqual({ bankCode: "0001", bankName: "みずほ", branchCode: "240", branchName: "新宿", confident: true });
    expect(r.body.branch.candidates[0].kanaHalfWidth).toBe("ｼﾝｼﾞﾕｸ");
    expect((await request(app).get("/v1/jp/bank/resolve")).status).toBe(400);
  });

  it("GET /v1/jp/bank/lookup returns names by code, 404 for unknown", async () => {
    const r = await request(app).get("/v1/jp/bank/lookup?bankCode=9900&branchCode=108");
    expect(r.status).toBe(200);
    expect(r.body.bank.kind).toBe("jp-bank");
    expect(r.body.branch.name).toBe("一〇八");
    expect((await request(app).get("/v1/jp/bank/lookup?bankCode=0000")).status).toBe(404);
    expect((await request(app).get("/v1/jp/bank/lookup?bankCode=12")).status).toBe(400);
  });

  it("GET /v1/jp/name/parse splits, reads and romanizes", async () => {
    const r = await request(app).get("/v1/jp/name/parse?name=%E4%BD%90%E8%97%A4%E8%A3%95%E5%AD%90");
    expect(r.status).toBe(200);
    expect(r.body.family.kanji).toBe("佐藤");
    expect(r.body.given.kanji).toBe("裕子");
    expect(r.body.romaji.passport).toBe("SATO YUKO");
    const k = await request(app).get("/v1/jp/name/parse?name=%E4%BD%90%E8%97%A4%E8%A3%95%E5%AD%90&kana=%E3%81%95%E3%81%A8%E3%81%86%20%E3%81%B2%E3%82%8D%E3%81%93");
    expect(k.body.romaji).toMatchObject({ basis: "provided-kana", passport: "SATO HIROKO" });
    expect((await request(app).get("/v1/jp/name/parse")).status).toBe(400);
  });

  it("GET /v1/jp/name/romaji handles one or two tokens", async () => {
    const two = await request(app).get("/v1/jp/name/romaji?kana=%E3%81%8A%E3%81%8A%E3%81%AE%20%E3%82%8A%E3%82%87%E3%81%86");
    expect(two.body.passport).toBe("ONO RYO");
    const one = await request(app).get("/v1/jp/name/romaji?kana=%E3%81%AF%E3%81%A3%E3%81%A8%E3%82%8A");
    expect(one.body.passport).toBe("HATTORI");
    expect((await request(app).get("/v1/jp/name/romaji?kana=%E4%BD%90%E8%97%A4")).status).toBe(400);
  });

  it("GET /v1/jp/business-day defaults to today (JST)", async () => {
    const r = await request(app).get("/v1/jp/business-day");
    expect(r.status).toBe(200);
    expect(r.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects invalid bodies with 400", async () => {
    const r = await request(app).post("/v1/text/normalize").send({ nope: 1 });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("bad_request");
  });

  it("POST /v1/company/resolve is 503 when HOJIN_APP_ID is not configured", async () => {
    const r = await request(app).post("/v1/company/resolve").send({ query: "トヨタ自動車" });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("upstream_not_configured");
  });

  it("POST /v1/address/normalize (integration) returns a parsed address", async () => {
    const r = await request(app).post("/v1/address/normalize").send({ address: "北海道札幌市西区24-2-2-3-3" });
    expect(r.status).toBe(200);
    expect(r.body.town).toBe("二十四軒二条二丁目");
  }, 30_000);

  it("unknown routes are 404 JSON", async () => {
    const r = await request(app).get("/nope");
    expect(r.status).toBe(404);
  });
});

/** Facilitator stub: advertises support for exact/base-sepolia and never settles. */
const stubFacilitator: FacilitatorClient = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
    extensions: [],
    signers: {},
  }),
  verify: async () => ({ isValid: false, invalidReason: "stub" }),
  settle: async () => ({ success: false, errorReason: "stub", transaction: "", network: "eip155:84532" }),
};

describe("free quota (try before you pay)", () => {
  const app = createApp(cfg, { paywall: true, facilitator: stubFacilitator, freeQuotaPerDay: 2 });

  it("grants N free calls per IP only with the opt-in header, then 402", async () => {
    const ip = "203.0.113.7";
    // crawlers (no header) always see the 402 challenge
    expect((await request(app).get("/v1/jp/holidays?year=2026").set("X-Forwarded-For", ip)).status).toBe(402);
    const a = await request(app).get("/v1/jp/holidays?year=2026").set("X-Forwarded-For", ip).set("X-Free-Tier", "1");
    expect(a.status).toBe(200);
    const b = await request(app).get("/v1/jp/name/romaji?kana=%E3%81%95%E3%81%A8%E3%81%86").set("X-Forwarded-For", ip).set("X-Free-Tier", "1");
    expect(b.status).toBe(200);
    const c = await request(app).get("/v1/jp/holidays?year=2026").set("X-Forwarded-For", ip).set("X-Free-Tier", "1");
    expect(c.status).toBe(402);
    // a different IP has its own quota
    const d = await request(app).get("/v1/jp/holidays?year=2026").set("X-Forwarded-For", "198.51.100.9").set("X-Free-Tier", "1");
    expect(d.status).toBe(200);
  });
});

describe("/stats", () => {
  const app = createApp(cfg, { paywall: true, facilitator: stubFacilitator, freeQuotaPerDay: 5 });

  it("counts free grants and 402 challenges per route and serves JSON or HTML", async () => {
    await request(app).get("/v1/jp/holidays?year=2026").set("X-Forwarded-For", "203.0.113.50").set("X-Free-Tier", "1");
    await request(app).get("/v1/jp/holidays?year=2026").set("X-Forwarded-For", "203.0.113.51");
    const j = await request(app).get("/stats?format=json");
    expect(j.status).toBe(200);
    expect(j.body.payTo).toBe(TEST_ENV.PAY_TO_ADDRESS);
    const route = j.body.sinceBoot.routes["GET /v1/jp/holidays"];
    expect(route.free).toBe(1);
    expect(route.challenged).toBe(1);
    expect(route.paid).toBe(0);
    const h = await request(app).get("/stats").set("Accept", "text/html");
    expect(h.status).toBe(200);
    expect(h.headers["content-type"]).toMatch(/text\/html/);
    expect(h.text).toContain("売上ダッシュボード");
  }, 30_000);
});

describe("paywall (x402 challenge against a stub facilitator)", () => {
  const app = createApp(cfg, { paywall: true, facilitator: stubFacilitator, freeQuotaPerDay: 0 });

  it("unpaid GET returns 402 too ($0.005 = 5000 micro-USDC)", async () => {
    const r = await request(app).get("/v1/jp/holidays?year=2026");
    expect(r.status).toBe(402);
    const decoded = JSON.parse(Buffer.from(r.headers["payment-required"] as string, "base64").toString("utf8"));
    expect(decoded.accepts[0].amount).toBe("5000");
    expect(decoded.extensions?.bazaar?.info?.input?.type).toBe("http");
  });

  it("unpaid POST returns 402 with a PAYMENT-REQUIRED header naming our payTo", async () => {
    const r = await request(app).post("/v1/text/normalize").send({ text: "x" });
    expect(r.status).toBe(402);
    const header = r.headers["payment-required"];
    expect(typeof header).toBe("string");
    const decoded = JSON.parse(Buffer.from(header as string, "base64").toString("utf8"));
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0].network).toBe("eip155:84532");
    expect(decoded.accepts[0].payTo.toLowerCase()).toBe(TEST_ENV.PAY_TO_ADDRESS);
    expect(decoded.accepts[0].amount).toBe("10000"); // $0.01 in USDC (6 decimals)
  });

  it("discovery routes stay free", async () => {
    expect((await request(app).get("/openapi.json")).status).toBe(200);
    expect((await request(app).get("/health")).status).toBe(200);
    expect((await request(app).get("/v1/holidays/countries")).status).toBe(200);
  });
});
