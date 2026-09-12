import { createFacilitatorConfig } from "@coinbase/x402";
import type { FacilitatorConfig } from "@x402/core/http";
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  type FacilitatorClient,
  type RoutesConfig,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { TESTNET_FACILITATOR_URL, type Config } from "../config.js";
import { ENDPOINTS } from "./catalog.js";

/** Pick the facilitator: Coinbase CDP on mainnet, the public x402.org one on testnet. */
export function facilitatorConfigFor(cfg: Config): FacilitatorConfig {
  if (cfg.isMainnet) {
    // CDP_API_KEY_* presence is enforced by loadConfig()
    return createFacilitatorConfig(cfg.CDP_API_KEY_ID, cfg.CDP_API_KEY_SECRET);
  }
  return { url: cfg.FACILITATOR_URL ?? TESTNET_FACILITATOR_URL };
}

export function buildResourceServer(cfg: Config, facilitator?: FacilitatorClient): x402ResourceServer {
  const client = facilitator ?? new HTTPFacilitatorClient(facilitatorConfigFor(cfg));
  return new x402ResourceServer(client)
    .register(cfg.networkId, new ExactEvmScheme())
    .registerExtension(bazaarResourceServerExtension);
}

/** Express route → price map, with Bazaar discovery metadata so agents can learn the schema. */
export function buildRoutes(cfg: Config): RoutesConfig {
  return Object.fromEntries(
    ENDPOINTS.map((e) => [
      e.key,
      {
        accepts: {
          scheme: "exact",
          price: e.price,
          network: cfg.networkId,
          payTo: cfg.PAY_TO_ADDRESS,
          maxTimeoutSeconds: 60,
        },
        description: e.description,
        mimeType: "application/json",
        serviceName: cfg.SERVICE_NAME,
        tags: [...e.tags],
        extensions: declareDiscoveryExtension(
          e.kind === "body"
            ? { bodyType: "json", input: { ...e.input }, inputSchema: { ...e.inputSchema }, output: { example: e.outputExample } }
            : { input: { ...e.input }, inputSchema: { ...e.inputSchema }, output: { example: e.outputExample } },
        ),
      },
    ]),
  );
}
