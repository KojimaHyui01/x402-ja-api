import request from "supertest";
import { describe, expect, it } from "vitest";
import type { FacilitatorClient } from "@x402/core/server";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

/**
 * The settle path — verify → settle → onAfterSettle → /stats — against a facilitator stub that
 * *succeeds*. The other suites only ever exercise the refusal path (their stub hardcodes failure),
 * so without this nothing covers what happens when money actually arrives.
 *
 * No wallet and no chain access: ExactEvmScheme does no local signature checking (verification is
 * delegated to the facilitator), and the PAYMENT-SIGNATURE header is plain base64 JSON, so the
 * payload is assembled from the server's own 402 challenge and signed with a dummy signature.
 */

const STATS_TOKEN = "test-stats-token-0123456789";

const TEST_ENV = {
  PAY_TO_ADDRESS: "0x1111111111111111111111111111111111111111",
  X402_NETWORK: "base-sepolia",
  PUBLIC_BASE_URL: "https://example.test",
  SERVICE_NAME: "ja-normalize-test",
  STATS_TOKEN,
};

const cfg = loadConfig(TEST_ENV);
const NETWORK = "eip155:84532";
const TX_HASH = `0x${"ab".repeat(32)}`;
const PAYER = "0x857b06519E91e3A54538791bDbb0E22373e36b66";

/** Facilitator stub that accepts the payment and reports a settled transaction. */
const settlingFacilitator: FacilitatorClient = {
  getSupported: async () => ({
    kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }],
    extensions: [],
    signers: {},
  }),
  verify: async () => ({ isValid: true, payer: PAYER }),
  settle: async () => ({ success: true, transaction: TX_HASH, network: NETWORK, payer: PAYER }),
};

interface Challenge {
  readonly resource: unknown;
  readonly accepts: readonly { readonly amount: string; readonly payTo: string }[];
}

function decodeChallenge(header: string): Challenge {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as Challenge;
}

/** Build the PAYMENT-SIGNATURE header an agent would send in reply to `challenge`. */
function paymentHeader(challenge: Challenge): string {
  const accepted = challenge.accepts[0]!;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    x402Version: 2,
    resource: challenge.resource,
    accepted,
    payload: {
      signature: `0x${"11".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: String(now - 60),
        validBefore: String(now + 600),
        nonce: `0x${"22".repeat(32)}`,
      },
    },
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

describe("settlement (paying client against a facilitator stub that succeeds)", () => {
  const app = createApp(cfg, { paywall: true, facilitator: settlingFacilitator, freeQuotaPerDay: 0 });

  it("serves the resource and reports the settlement to the buyer", async () => {
    const challenge = decodeChallenge(
      (await request(app).get("/v1/jp/holidays?year=2026")).headers["payment-required"] as string,
    );

    const paid = await request(app).get("/v1/jp/holidays?year=2026").set("PAYMENT-SIGNATURE", paymentHeader(challenge));

    expect(paid.status).toBe(200);
    expect(paid.body.year).toBe(2026);
    const receipt = paid.headers["payment-response"];
    expect(typeof receipt).toBe("string");
    const settled = JSON.parse(Buffer.from(receipt as string, "base64").toString("utf8"));
    expect(settled.success).toBe(true);
    expect(settled.transaction).toBe(TX_HASH);
  });

  it("counts the payment under the same /stats route key as the 402 it answered", async () => {
    const challenge = decodeChallenge(
      (await request(app).post("/v1/text/normalize").send({ text: "x" })).headers["payment-required"] as string,
    );

    await request(app)
      .post("/v1/text/normalize")
      .set("PAYMENT-SIGNATURE", paymentHeader(challenge))
      .send({ text: "令和5年4月1日" });

    const stats = await request(app).get("/stats?format=json").auth(STATS_TOKEN, { type: "bearer" });
    const routes = stats.body.sinceBoot.routes as Record<string, { challenged: number; paid: number; paidMicroUsdc: number }>;

    // The challenge and the payment describe the same endpoint, so they must land in one bucket.
    expect(Object.keys(routes)).not.toContain("/v1/text/normalize");
    const route = routes["POST /v1/text/normalize"];
    expect(route).toBeDefined();
    expect(route!.challenged).toBe(1);
    expect(route!.paid).toBe(1);
    expect(route!.paidMicroUsdc).toBe(10_000); // $0.01 in USDC (6 decimals)
  }, 30_000);

  it("records the payment in recentPayments with its tx hash and payer", async () => {
    const stats = await request(app).get("/stats?format=json").auth(STATS_TOKEN, { type: "bearer" });
    const recent = stats.body.sinceBoot.recentPayments as readonly { tx: string; payer: string; usdc: number }[];
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0]!.tx).toBe(TX_HASH);
    expect(recent[0]!.payer).toBe(PAYER);
    expect(recent[0]!.usdc).toBeCloseTo(0.01, 6);
  }, 30_000);
});
