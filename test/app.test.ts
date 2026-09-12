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
    expect(r.text).toContain("x402-price: 0.01");
    expect(r.text).toContain(`x402-pay-to: ${TEST_ENV.PAY_TO_ADDRESS}`);
  });

  it("serves /.well-known/x402 with absolute resource URLs", async () => {
    const r = await request(app).get("/.well-known/x402");
    expect(r.status).toBe(200);
    expect(r.body.resources).toContain("https://example.test/v1/text/normalize");
    expect(r.body.ownershipProofs).toEqual([TEST_ENV.PAY_TO_ADDRESS]);
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

describe("paywall (x402 challenge against a stub facilitator)", () => {
  const app = createApp(cfg, { paywall: true, facilitator: stubFacilitator });

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
  });
});
