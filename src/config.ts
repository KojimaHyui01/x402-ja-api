import "dotenv/config";
import { z } from "zod";

/** Human-friendly network name → CAIP-2 id used by x402. */
export const NETWORK_IDS = {
  "base-sepolia": "eip155:84532",
  base: "eip155:8453",
} as const;

export const TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4021),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4021"),
  SERVICE_NAME: z.string().min(1).default("ja-normalize"),
  PAY_TO_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed EVM address"),
  X402_NETWORK: z.enum(["base-sepolia", "base"]).default("base-sepolia"),
  FACILITATOR_URL: z.string().url().optional(),
  CDP_API_KEY_ID: z.string().min(1).optional(),
  CDP_API_KEY_SECRET: z.string().min(1).optional(),
  HOJIN_APP_ID: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export interface Config extends Env {
  /** CAIP-2 network id, e.g. eip155:8453 */
  readonly networkId: (typeof NETWORK_IDS)[keyof typeof NETWORK_IDS];
  readonly isMainnet: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Hosting dashboards often send blank strings for unset vars; treat those as absent. */
function dropBlank(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((kv): kv is [string, string] => typeof kv[1] === "string" && kv[1].trim() !== ""),
  );
}

/** Validate environment at startup and fail fast with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(dropBlank(env));
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const isMainnet = e.X402_NETWORK === "base";
  if (isMainnet && (!e.CDP_API_KEY_ID || !e.CDP_API_KEY_SECRET)) {
    throw new ConfigError(
      "X402_NETWORK=base requires CDP_API_KEY_ID and CDP_API_KEY_SECRET (Coinbase CDP facilitator)",
    );
  }
  return Object.freeze({ ...e, networkId: NETWORK_IDS[e.X402_NETWORK], isMainnet });
}
