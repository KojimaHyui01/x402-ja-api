import { Router } from "express";
import { fileURLToPath } from "node:url";
import type { Config } from "../config.js";
import { ENDPOINTS, type Endpoint } from "../x402/catalog.js";

/**
 * Machine-readable discovery documents read by x402scan / CDP Bazaar crawlers:
 *  - GET /openapi.json        (OpenAPI 3.1 + x-payment-info per operation + x-discovery.ownershipProofs)
 *  - GET /.well-known/x402    (resource list + ownership proof)
 *  - GET /health, GET /
 */

const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

function usdcAssetFor(cfg: Config): string {
  return cfg.isMainnet ? USDC_BASE_MAINNET : USDC_BASE_SEPOLIA;
}

function operationFor(cfg: Config, e: Endpoint): Record<string, unknown> {
  return {
    operationId: e.path.replace(/^\/v1\//, "").replace(/\//g, "_"),
    summary: e.summary,
    description: e.description,
    tags: [...e.tags],
    requestBody: {
      required: true,
      content: { "application/json": { schema: e.inputSchema, example: e.input } },
    },
    responses: {
      "200": { description: "OK", content: { "application/json": { example: e.outputExample } } },
      "400": { description: "Invalid input" },
      "402": { description: "Payment required (x402)" },
    },
    "x-payment-info": {
      protocol: "x402",
      x402Version: 2,
      scheme: "exact",
      network: cfg.networkId,
      price: e.price,
      asset: usdcAssetFor(cfg),
      payTo: cfg.PAY_TO_ADDRESS,
    },
  };
}

export function buildOpenApi(cfg: Config): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: cfg.SERVICE_NAME,
      version: "0.1.0",
      description:
        "Japanese text-to-structure APIs (address normalization, business-text normalization, corporate entity resolution). Pay per call in USDC via x402.",
      contact: { name: cfg.SERVICE_NAME, email: cfg.CONTACT_EMAIL, url: cfg.PUBLIC_BASE_URL },
    },
    servers: [{ url: cfg.PUBLIC_BASE_URL }],
    "x-discovery": { ownershipProofs: [cfg.PAY_TO_ADDRESS] },
    paths: Object.fromEntries(ENDPOINTS.map((e) => [e.path, { [e.method.toLowerCase()]: operationFor(cfg, e) }])),
  };
}

export function buildWellKnown(cfg: Config): Record<string, unknown> {
  return {
    version: 1,
    x402Version: 2,
    serviceName: cfg.SERVICE_NAME,
    resources: ENDPOINTS.map((e) => `${cfg.PUBLIC_BASE_URL}${e.path}`),
    ownershipProofs: [cfg.PAY_TO_ADDRESS],
    openapi: `${cfg.PUBLIC_BASE_URL}/openapi.json`,
  };
}

const EOL = String.fromCharCode(10);

/** x402Relay manifest scanner format (https://docs.x402-relay.com/providers/register/). */
export function buildAiTxt(cfg: Config): string {
  const cheapest = ENDPOINTS.reduce((min, e) => (parseFloat(e.price.slice(1)) < parseFloat(min.price.slice(1)) ? e : min));
  const lines = [
    `x402-endpoint: ${cfg.PUBLIC_BASE_URL}`,
    `x402-network: ${cfg.isMainnet ? "base" : "base-sepolia"}`,
    "x402-asset: USDC",
    `x402-price: ${cheapest.price.slice(1)}`,
    `x402-pay-to: ${cfg.PAY_TO_ADDRESS}`,
    `x402-openapi: ${cfg.PUBLIC_BASE_URL}/openapi.json`,
    `x402-well-known: ${cfg.PUBLIC_BASE_URL}/.well-known/x402`,
    `contact: ${cfg.CONTACT_EMAIL}`,
    ...ENDPOINTS.map((e) => `x402-resource: ${e.method} ${cfg.PUBLIC_BASE_URL}${e.path} ${e.price}`),
  ];
  return `${lines.join(EOL)}${EOL}`;
}

export function discoveryRouter(cfg: Config): Router {
  const router = Router();
  const openapi = buildOpenApi(cfg);
  const wellKnown = buildWellKnown(cfg);

  const faviconPath = fileURLToPath(new URL("../../public/favicon.ico", import.meta.url));
  router.get("/favicon.ico", (_req, res) => {
    res.type("image/x-icon").set("Cache-Control", "public, max-age=86400").sendFile(faviconPath);
  });
  router.get("/health", (_req, res) => {
    res.json({ ok: true, network: cfg.networkId, endpoints: ENDPOINTS.length });
  });
  router.get("/openapi.json", (_req, res) => res.json(openapi));
  router.get(["/.well-known/x402", "/.well-known/x402.json"], (_req, res) => res.json(wellKnown));
  const aiTxt = buildAiTxt(cfg);
  router.get("/.well-known/ai.txt", (_req, res) => res.type("text/plain").send(aiTxt));
  router.get("/", (_req, res) => {
    res.json({
      service: cfg.SERVICE_NAME,
      description: "Japanese text-to-structure APIs for AI agents. Pay per call with USDC (x402).",
      network: cfg.networkId,
      endpoints: ENDPOINTS.map((e) => ({ method: e.method, path: e.path, price: e.price, summary: e.summary })),
      openapi: `${cfg.PUBLIC_BASE_URL}/openapi.json`,
      wellKnown: `${cfg.PUBLIC_BASE_URL}/.well-known/x402`,
      attribution: [
        "住所データ: デジタル庁 アドレス・ベース・レジストリ (via @geolonia/normalize-japanese-addresses)",
        "このサービスは、国税庁法人番号システムのWeb-API機能を利用して取得した情報をもとに作成しているが、サービスの内容は国税庁によって保証されたものではない",
      ],
    });
  });
  return router;
}
