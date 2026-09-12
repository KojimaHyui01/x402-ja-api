/**
 * End-to-end paying client: acts like an AI agent, pays the 402 in USDC and prints the result.
 *
 * Usage (testnet):
 *   BUYER_PRIVATE_KEY=0x... npm run probe -- [baseUrl] [path]
 *
 * Requirements:
 *   - a wallet with Base Sepolia USDC (faucet: https://faucet.circle.com) — this is the *buyer*,
 *     keep it separate from PAY_TO_ADDRESS.
 *   - the server running against the same network.
 */
import "dotenv/config";
import { x402Client } from "@x402/core/client";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { findEndpoint } from "../src/x402/catalog.js";

const baseUrl = (process.argv[2] ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:4021").replace(/\/$/, "");
const path = process.argv[3] ?? "/v1/text/normalize";
const network = process.env.X402_NETWORK ?? "base-sepolia";

function requirePrivateKey(): `0x${string}` {
  const key = process.env.BUYER_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("BUYER_PRIVATE_KEY (0x + 64 hex) is required. Use a throwaway testnet wallet.");
    process.exit(1);
  }
  return key as `0x${string}`;
}

async function main(): Promise<void> {
  const endpoint = findEndpoint("POST", path);
  if (!endpoint) {
    console.error(`unknown endpoint ${path}`);
    process.exit(1);
  }

  const account = privateKeyToAccount(requirePrivateKey());
  const chain = network === "base" ? base : baseSepolia;
  const publicClient = createPublicClient({ chain, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);
  const client = registerExactEvmScheme(new x402Client(), { signer });
  const payingFetch = wrapFetchWithPayment(fetch, client);

  console.log(`buyer   : ${account.address}`);
  console.log(`target  : POST ${baseUrl}${path}  (${endpoint.price})`);
  console.log(`body    : ${JSON.stringify(endpoint.input)}\n`);

  const started = Date.now();
  const res = await payingFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(endpoint.input),
  });
  const elapsed = Date.now() - started;
  const body = await res.text();

  console.log(`status  : ${res.status}  (${elapsed} ms)`);
  const receipt = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
  if (receipt) {
    const settled = decodePaymentResponseHeader(receipt);
    console.log(`settled : ${JSON.stringify(settled)}`);
  } else {
    console.log("settled : (no payment-response header — payment not settled)");
  }
  console.log(`response: ${body.slice(0, 1200)}`);
  process.exit(res.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("probe failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
