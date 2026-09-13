import { x402Client } from "@x402/core/client";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Plain fetch (free quota) or, when a private key is configured, an x402-paying fetch
 * that transparently answers 402 challenges with USDC on Base.
 */
export function createFetch(privateKey: string | undefined): FetchLike {
  if (!privateKey) return (input, init) => fetch(input, init);
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("X402_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key");
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const signer = toClientEvmSigner(account, publicClient);
  const client = registerExactEvmScheme(new x402Client(), { signer });
  const paying = wrapFetchWithPayment(fetch, client);
  return (input, init) => paying(input, init);
}
