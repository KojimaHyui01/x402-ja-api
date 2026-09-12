/**
 * Self-check a deployed instance the way x402scan / Bazaar crawlers do:
 *   1. /openapi.json parses and lists every catalog endpoint with x-payment-info
 *   2. /.well-known/x402 lists the same resources + ownership proof
 *   3. every paid route answers an unpaid request with a real 402 challenge
 *
 * Usage: npm run doctor -- https://your-domain.example
 *        (defaults to PUBLIC_BASE_URL from .env, then http://localhost:4021)
 */
import "dotenv/config";
import { ENDPOINTS } from "../src/x402/catalog.js";

const base = (process.argv[2] ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:4021").replace(/\/$/, "");

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`, { headers: { Accept: "application/json" } });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

async function checkOpenApi(): Promise<Check[]> {
  const { status, body } = await getJson("/openapi.json");
  if (status !== 200 || typeof body !== "object" || body === null) {
    return [{ name: "openapi.json reachable", ok: false, detail: `status ${status}` }];
  }
  const doc = body as { paths?: Record<string, Record<string, { "x-payment-info"?: unknown }>>; "x-discovery"?: { ownershipProofs?: string[] } };
  const checks: Check[] = [{ name: "openapi.json reachable", ok: true }];
  checks.push({
    name: "openapi x-discovery.ownershipProofs present",
    ok: Array.isArray(doc["x-discovery"]?.ownershipProofs) && doc["x-discovery"]!.ownershipProofs!.length > 0,
  });
  for (const e of ENDPOINTS) {
    const op = doc.paths?.[e.path]?.[e.method.toLowerCase()];
    checks.push({ name: `openapi lists ${e.method} ${e.path} with x-payment-info`, ok: Boolean(op?.["x-payment-info"]) });
  }
  return checks;
}

async function checkWellKnown(): Promise<Check[]> {
  const { status, body } = await getJson("/.well-known/x402");
  if (status !== 200 || typeof body !== "object" || body === null) {
    return [{ name: ".well-known/x402 reachable", ok: false, detail: `status ${status}` }];
  }
  const doc = body as { resources?: string[]; ownershipProofs?: string[] };
  const missing = ENDPOINTS.filter((e) => !doc.resources?.includes(`${base}${e.path}`));
  return [
    { name: ".well-known/x402 reachable", ok: true },
    { name: ".well-known lists every resource with this origin", ok: missing.length === 0, detail: missing.map((m) => m.path).join(", ") || undefined },
    { name: ".well-known ownershipProofs present", ok: (doc.ownershipProofs?.length ?? 0) > 0 },
  ];
}

async function check402(): Promise<Check[]> {
  const out: Check[] = [];
  for (const e of ENDPOINTS) {
    const qs = e.kind === "query" ? `?${new URLSearchParams(Object.entries(e.input).map(([k, v]) => [k, String(v)]))}` : "";
    const res = await fetch(`${base}${e.path}${qs}`, {
      method: e.method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: e.kind === "body" ? JSON.stringify(e.input) : undefined,
    });
    const header = res.headers.get("payment-required");
    let detail: string | undefined;
    let ok = res.status === 402 && header !== null;
    if (ok) {
      try {
        const decoded = JSON.parse(Buffer.from(header!, "base64").toString("utf8")) as { accepts?: { amount?: string; network?: string }[] };
        const a = decoded.accepts?.[0];
        detail = a ? `${a.network} amount=${a.amount}` : "no accepts[]";
        ok = Boolean(a?.amount && a.network);
      } catch {
        ok = false;
        detail = "PAYMENT-REQUIRED header is not base64 JSON";
      }
    } else {
      detail = `status ${res.status}`;
    }
    out.push({ name: `402 challenge on ${e.method} ${e.path}`, ok, detail });
  }
  return out;
}

async function main(): Promise<void> {
  console.log(`doctor: ${base}\n`);
  const checks = [...(await checkOpenApi()), ...(await checkWellKnown()), ...(await check402())];
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (base.startsWith("http://localhost") || /ngrok|trycloudflare|loca\.lt/.test(base)) {
    console.log("\nnote: x402scan refuses localhost / tunnel origins. Deploy to a permanent domain before registering.");
  } else if (failed === 0) {
    console.log(`\nready to register. Next:\n  curl -X POST https://www.x402scan.com/api/x402/registry/register-origin -H 'Content-Type: application/json' -d '{"origin":"${base}"}'\n  (x402scan may require Sign-In-With-X; if so, register from their UI with the payTo wallet.)`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("doctor failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
