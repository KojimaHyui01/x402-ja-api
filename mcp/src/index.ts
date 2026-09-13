#!/usr/bin/env node
/**
 * ja-normalize MCP server — exposes https://x402-ja-api.onrender.com as MCP tools.
 *
 * Works without any setup thanks to the API's free daily quota. To go beyond the quota, set
 * X402_PRIVATE_KEY to a wallet holding USDC on Base and calls are paid automatically via x402.
 *
 * Env:
 *   JA_NORMALIZE_BASE_URL  (default https://x402-ja-api.onrender.com)
 *   X402_PRIVATE_KEY       optional 0x… key of a Base wallet with USDC (never logged)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createFetch } from "./fetch.js";

const BASE = (process.env.JA_NORMALIZE_BASE_URL ?? "https://x402-ja-api.onrender.com").replace(/\/$/, "");
const doFetch = createFetch(process.env.X402_PRIVATE_KEY);

type Json = Record<string, unknown>;

async function callGet(path: string, params: Record<string, string | number | undefined>): Promise<Json> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const res = await doFetch(`${BASE}${path}?${qs.toString()}`, { headers: { Accept: "application/json", "X-Free-Tier": "1" } });
  return handle(res);
}

async function callPost(path: string, body: Json): Promise<Json> {
  const res = await doFetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Free-Tier": "1" },
    body: JSON.stringify(body),
  });
  return handle(res);
}

async function handle(res: Response): Promise<Json> {
  const text = await res.text();
  let data: Json;
  try {
    data = JSON.parse(text) as Json;
  } catch {
    data = { raw: text };
  }
  if (res.status === 402) {
    throw new Error(
      "Free daily quota exhausted and no wallet configured. Set X402_PRIVATE_KEY to a Base wallet holding USDC to pay per call (≈$0.005–$0.03).",
    );
  }
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

const asText = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

const server = new McpServer({ name: "ja-normalize", version: "0.1.0" });

server.registerTool(
  "holidays",
  {
    title: "Public holidays (200+ countries)",
    description: "Public/bank/school holidays for a country and year, with optional region (US-CA → region=CA) and type filter.",
    inputSchema: {
      country: z.string().length(2).describe("ISO 3166-1 alpha-2, e.g. US, DE, JP"),
      year: z.number().int().min(1900).max(2100),
      region: z.string().max(10).optional(),
      types: z.string().optional().describe("comma list: public,bank,school,optional,observance"),
    },
  },
  async (a) => asText(await callGet("/v1/holidays", a)),
);

server.registerTool(
  "business_day",
  {
    title: "Business-day calculator (any country)",
    description: "Is a date a business day in a country? Add/subtract N business days honouring holidays and the local weekend (e.g. Fri-Sat in Saudi Arabia).",
    inputSchema: {
      country: z.string().length(2),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD, default today"),
      add: z.number().int().min(-2000).max(2000).default(0),
      region: z.string().max(10).optional(),
      weekend: z.string().optional().describe("override, weekday numbers 0=Sun e.g. 5,6"),
      calendar: z.enum(["standard", "bank"]).default("standard"),
    },
  },
  async (a) => asText(await callGet("/v1/business-day", a)),
);

server.registerTool(
  "holiday_countries",
  {
    title: "List supported countries / regions (free)",
    description: "Lists supported country codes, or the regions of one country when `country` is given.",
    inputSchema: { country: z.string().length(2).optional() },
  },
  async (a) => asText(await callGet("/v1/holidays/countries", a)),
);

server.registerTool(
  "jp_business_day",
  {
    title: "Japanese business-day calculator (official 内閣府 data)",
    description: "Japanese holidays incl. 振替休日/国民の休日; add N business days; 月末営業日; calendar=bank also closes Dec 31–Jan 3.",
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      add: z.number().int().min(-2000).max(2000).default(0),
      calendar: z.enum(["standard", "bank"]).default("standard"),
    },
  },
  async (a) => asText(await callGet("/v1/jp/business-day", a)),
);

server.registerTool(
  "jp_bank_resolve",
  {
    title: "Japanese bank / branch name → codes",
    description: "Fuzzy-resolve a bank (銀行/信金/信組/労金/JA) and optional branch name to 金融機関コード and 支店コード, with half-width kana for 全銀 files.",
    inputSchema: { bank: z.string().min(1).max(100), branch: z.string().min(1).max(100).optional() },
  },
  async (a) => asText(await callGet("/v1/jp/bank/resolve", a)),
);

server.registerTool(
  "jp_bank_lookup",
  {
    title: "Japanese bank / branch by code",
    description: "Exact lookup of a 4-digit bank code (+ optional 3-digit branch code).",
    inputSchema: { bankCode: z.string().regex(/^\d{4}$/), branchCode: z.string().regex(/^\d{3}$/).optional() },
  },
  async (a) => asText(await callGet("/v1/jp/bank/lookup", a)),
);

server.registerTool(
  "jp_name_parse",
  {
    title: "Japanese personal name → family/given, readings, passport romaji",
    description: "Splits a kanji full name, returns ranked reading candidates with confidence and 外務省 passport romaji. Pass `kana` (\"<family> <given>\") when known for a deterministic result.",
    inputSchema: { name: z.string().min(1).max(40), kana: z.string().max(100).optional() },
  },
  async (a) => asText(await callGet("/v1/jp/name/parse", a)),
);

server.registerTool(
  "jp_name_romaji",
  {
    title: "Kana → Hepburn romaji (passport rules)",
    description: "Deterministic romanization: passport form (SATO, ONO, NAMBA), OH-style, macron and strict forms. Input \"さとう ゆうこ\" or a single token.",
    inputSchema: { kana: z.string().min(1).max(100) },
  },
  async (a) => asText(await callGet("/v1/jp/name/romaji", a)),
);

server.registerTool(
  "jp_address_normalize",
  {
    title: "Japanese address normalization + coordinates",
    description: "Normalizes any Japanese address notation to pref/city/town/block against the Address Base Registry and returns WGS84 coordinates.",
    inputSchema: { address: z.string().min(1).max(200), level: z.number().int().optional() },
  },
  async (a) => asText(await callPost("/v1/address/normalize", a)),
);

server.registerTool(
  "jp_text_normalize",
  {
    title: "Japanese business text normalization",
    description: "Full-width → half-width, 和暦 → ISO dates, extracts phone numbers (E.164), postal codes and emails from free text.",
    inputSchema: { text: z.string().min(1).max(20000) },
  },
  async (a) => asText(await callPost("/v1/text/normalize", a)),
);

server.registerTool(
  "jp_company_resolve",
  {
    title: "Japanese company name → 法人番号 (NTA registry)",
    description: "Fuzzy company-name or 13-digit corporate-number lookup with registered address and invoice-number format.",
    inputSchema: { query: z.string().min(1).max(100), prefectureCode: z.string().regex(/^[0-4][0-9]$/).optional() },
  },
  async (a) => asText(await callPost("/v1/company/resolve", a)),
);

server.registerTool(
  "jp_crypto_ticker",
  {
    title: "JPY crypto prices + Japan premium",
    description: "BTC/ETH/XRP prices on bitFlyer, Coincheck, GMO Coin and bitbank, cross-exchange median, USD reference, USD/JPY and the Japan premium vs USD.",
    inputSchema: { symbol: z.enum(["BTC", "ETH", "XRP"]).default("BTC") },
  },
  async (a) => asText(await callGet("/v1/jp/crypto/ticker", a)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
