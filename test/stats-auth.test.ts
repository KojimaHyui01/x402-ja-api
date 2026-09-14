import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

/** /stats reports who used the service, so it must never be readable without the secret. */

const STATS_TOKEN = "test-stats-token-0123456789";

const BASE_ENV = {
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  X402_NETWORK: "base-sepolia",
  PUBLIC_BASE_URL: "https://example.test",
  SERVICE_NAME: "ja-normalize-test",
};

const guarded = createApp(loadConfig({ ...BASE_ENV, STATS_TOKEN }), { paywall: false });
const unconfigured = createApp(loadConfig(BASE_ENV), { paywall: false });

describe("/stats access control", () => {
  it("rejects a token shorter than 16 characters at startup", () => {
    expect(() => loadConfig({ ...BASE_ENV, STATS_TOKEN: "short" })).toThrow(/at least 16/);
  });

  it("is disabled, not public, when STATS_TOKEN is unset", async () => {
    const r = await request(unconfigured).get("/stats?format=json");
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("stats_disabled");
  });

  it("challenges an anonymous browser so it can prompt for credentials", async () => {
    const r = await request(guarded).get("/stats").set("Accept", "text/html");
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toMatch(/^Basic realm=/);
    expect(r.text).not.toContain("売上ダッシュボード");
  });

  it("rejects a wrong token", async () => {
    const r = await request(guarded).get("/stats?format=json").auth("wrong-but-long-enough-token", { type: "bearer" });
    expect(r.status).toBe(401);
  });

  it("accepts the token as a bearer header", async () => {
    const r = await request(guarded).get("/stats?format=json").auth(STATS_TOKEN, { type: "bearer" });
    expect(r.status).toBe(200);
    expect(r.body.payTo).toBe(BASE_ENV.PAY_TO_ADDRESS);
  }, 30_000);

  it("accepts the token as the password of a basic-auth login", async () => {
    const r = await request(guarded).get("/stats?format=json").auth("operator", STATS_TOKEN);
    expect(r.status).toBe(200);
  }, 30_000);

  it("accepts the token as a query parameter", async () => {
    const r = await request(guarded).get(`/stats?format=json&token=${STATS_TOKEN}`);
    expect(r.status).toBe(200);
  }, 30_000);

  it("leaves the free discovery documents open", async () => {
    expect((await request(guarded).get("/health")).status).toBe(200);
    expect((await request(guarded).get("/openapi.json")).status).toBe(200);
  });
});
