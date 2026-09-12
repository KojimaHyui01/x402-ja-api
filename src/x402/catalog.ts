/**
 * Single source of truth for what this service sells.
 * Used by: payment middleware (routes), /openapi.json, /.well-known/x402, and the doctor script.
 */

export interface Endpoint {
  /** e.g. "POST /v1/address/normalize" */
  readonly key: `${"GET" | "POST"} /${string}`;
  readonly method: "GET" | "POST";
  readonly path: string;
  /** USD price string accepted by x402 ("$0.02") */
  readonly price: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly input: Readonly<Record<string, unknown>>;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputExample: Readonly<Record<string, unknown>>;
}

const ADDRESS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    address: { type: "string", maxLength: 200, description: "Japanese address in any notation" },
    level: { type: "integer", enum: [1, 2, 3, 8], default: 8, description: "Max normalization depth" },
  },
  required: ["address"],
} as const;

const TEXT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", maxLength: 20000, description: "Japanese business text (letters, forms, OCR output)" },
  },
  required: ["text"],
} as const;

const COMPANY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    query: {
      type: "string",
      maxLength: 100,
      description: "13-digit 法人番号 (optionally prefixed with T) or a company name in any notation",
    },
    prefectureCode: { type: "string", pattern: "^[0-4][0-9]$", description: "Optional JIS prefecture code filter" },
  },
  required: ["query"],
} as const;

export const ENDPOINTS: readonly Endpoint[] = [
  {
    key: "POST /v1/address/normalize",
    method: "POST",
    path: "/v1/address/normalize",
    price: "$0.02",
    summary: "Normalize a Japanese address",
    description:
      "Resolves notation variants (全角/半角, 旧字体, 丁目番地号, merged municipalities) against the Address Base Registry and returns pref/city/town/block plus WGS84 coordinates.",
    tags: ["japan", "address", "geocoding", "normalization", "text-to-structure"],
    input: { address: "東京都千代田区千代田１−１" },
    inputSchema: ADDRESS_INPUT_SCHEMA,
    outputExample: {
      input: "東京都千代田区千代田１−１",
      pref: "東京都",
      city: "千代田区",
      town: "千代田",
      addr: "1-1",
      other: "",
      level: 8,
      formatted: "東京都千代田区千代田1-1",
      point: { lat: 35.68, lng: 139.75, level: 8 },
    },
  },
  {
    key: "POST /v1/text/normalize",
    method: "POST",
    path: "/v1/text/normalize",
    price: "$0.01",
    summary: "Normalize Japanese business text and extract contact fields",
    description:
      "Converts full-width characters, 和暦 dates (令和/平成/昭和 → ISO-8601), and extracts phone numbers (E.164), postal codes and emails from free text.",
    tags: ["japan", "text", "normalization", "dates", "phone", "text-to-structure"],
    input: { text: "令和５年４月１日　ＴＥＬ：０３－１２３４－５６７８　〒１００－０００１" },
    inputSchema: TEXT_INPUT_SCHEMA,
    outputExample: {
      normalized: "2023-04-01 TEL:03-1234-5678 〒100-0001",
      dates: [{ original: "令和5年4月1日", iso: "2023-04-01" }],
      phones: [{ original: "03-1234-5678", e164: "+81312345678", national: "0312345678" }],
      postalCodes: ["1000001"],
      emails: [],
    },
  },
  {
    key: "POST /v1/company/resolve",
    method: "POST",
    path: "/v1/company/resolve",
    price: "$0.03",
    summary: "Resolve a Japanese company to its 法人番号 and registered address",
    description:
      "Fuzzy-matches a company name (or validates a 13-digit corporate number) against the National Tax Agency registry and returns ranked candidates with legal form, registered address and invoice-number format.",
    tags: ["japan", "company", "corporate-number", "entity-resolution", "kyc", "text-to-structure"],
    input: { query: "トヨタ自動車" },
    inputSchema: COMPANY_INPUT_SCHEMA,
    outputExample: {
      query: "トヨタ自動車",
      matchedBy: "name",
      totalCount: 1,
      candidates: [
        {
          corporateNumber: "1180301018771",
          invoiceNumberFormat: "T1180301018771",
          name: "トヨタ自動車株式会社",
          kind: "301",
          kindLabel: "株式会社",
          address: { prefecture: "愛知県", city: "豊田市", street: "トヨタ町1番地", postCode: "4718571", formatted: "愛知県豊田市トヨタ町1番地" },
          closed: false,
          exactNameMatch: true,
        },
      ],
    },
  },
];

export function findEndpoint(method: string, path: string): Endpoint | undefined {
  return ENDPOINTS.find((e) => e.method === method && e.path === path);
}
