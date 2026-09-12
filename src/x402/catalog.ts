/**
 * Single source of truth for what this service sells.
 * Used by: payment middleware (routes), /openapi.json, /.well-known/x402, and the doctor script.
 */

export interface Endpoint {
  /** e.g. "POST /v1/address/normalize" */
  readonly key: `${"GET" | "POST"} /${string}`;
  readonly method: "GET" | "POST";
  readonly path: string;
  /** "body" = JSON request body (POST); "query" = URL query parameters (GET) */
  readonly kind: "body" | "query";
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

const HOLIDAYS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    year: { type: "integer", minimum: 1955, maximum: 2100, description: "Western calendar year" },
  },
  required: ["year"],
} as const;

const BUSINESS_DAY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    date: { type: "string", format: "date", description: "Base date YYYY-MM-DD (default: today in JST)" },
    add: { type: "integer", minimum: -2000, maximum: 2000, default: 0, description: "Business days to add (negative = go back)" },
    calendar: {
      type: "string",
      enum: ["standard", "bank"],
      default: "standard",
      description: "standard = Sat/Sun/public holidays closed; bank = also Dec 31-Jan 3 (Japanese bank holidays)",
    },
  },
} as const;

const BANK_RESOLVE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    bank: { type: "string", maxLength: 100, description: "Bank / 信用金庫 / 信用組合 / 労働金庫 / JA name in any notation (kanji, kana, romaji, with or without 銀行)" },
    branch: { type: "string", maxLength: 100, description: "Optional branch name (支店 suffix optional; ゆうちょ numeric names accepted)" },
  },
  required: ["bank"],
} as const;

const BANK_LOOKUP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    bankCode: { type: "string", pattern: "^[0-9]{4}$", description: "4-digit 金融機関コード" },
    branchCode: { type: "string", pattern: "^[0-9]{3}$", description: "Optional 3-digit 支店コード" },
  },
  required: ["bankCode"],
} as const;

export const ENDPOINTS: readonly Endpoint[] = [
  {
    key: "GET /v1/jp/holidays",
    method: "GET",
    path: "/v1/jp/holidays",
    kind: "query",
    price: "$0.005",
    summary: "Japanese public holidays for a year",
    description:
      "Official 国民の祝日 list for a given year including substitute holidays (振替休日) and 国民の休日, straight from the Cabinet Office dataset. Coverage 1955-2027, refreshed yearly.",
    tags: ["japan", "holidays", "calendar", "dates"],
    input: { year: 2026 },
    inputSchema: HOLIDAYS_INPUT_SCHEMA,
    outputExample: {
      year: 2026,
      count: 19,
      holidays: [
        { date: "2026-01-01", name: "元日" },
        { date: "2026-01-12", name: "成人の日" },
        { date: "2026-09-22", name: "休日" },
      ],
      source: "内閣府 https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html",
    },
  },
  {
    key: "GET /v1/jp/business-day",
    method: "GET",
    path: "/v1/jp/business-day",
    kind: "query",
    price: "$0.005",
    summary: "Japanese business-day calculator",
    description:
      "Is this date a Japanese business day? Add or subtract N business days (payment due dates, SLA deadlines, 月末営業日) honoring weekends, public holidays and optionally Japanese bank holidays (Dec 31-Jan 3).",
    tags: ["japan", "business-days", "calendar", "dates", "finance"],
    input: { date: "2026-09-18", add: 1, calendar: "bank" },
    inputSchema: BUSINESS_DAY_INPUT_SCHEMA,
    outputExample: {
      date: "2026-09-18",
      weekday: "Friday",
      isWeekend: false,
      isHoliday: false,
      holidayName: null,
      isBusinessDay: true,
      calendar: "bank",
      nextBusinessDay: "2026-09-24",
      previousBusinessDay: "2026-09-17",
      add: 1,
      result: "2026-09-24",
      lastBusinessDayOfMonth: "2026-09-30",
    },
  },
  {
    key: "GET /v1/jp/bank/resolve",
    method: "GET",
    path: "/v1/jp/bank/resolve",
    kind: "query",
    price: "$0.02",
    summary: "Resolve a Japanese bank and branch name to 金融機関コード / 支店コード",
    description:
      "Fuzzy-matches bank and branch names (kanji, kana, romaji; 銀行/支店 optional; 信用金庫→信金, JA→農協) to official zengin codes and returns ranked candidates with confidence, plus half-width kana names ready for 全銀 transfer files. Covers 1,146 institutions and ~29,000 branches.",
    tags: ["japan", "bank", "branch", "zengin", "payments", "entity-resolution", "finance"],
    input: { bank: "三菱UFJ銀行", branch: "新宿支店" },
    inputSchema: BANK_RESOLVE_INPUT_SCHEMA,
    outputExample: {
      bank: {
        query: "三菱UFJ銀行",
        canonical: "三菱UFJ",
        confident: true,
        candidates: [{ code: "0005", name: "三菱ＵＦＪ", kana: "ミツビシユ－エフジエイ", kanaHalfWidth: "ﾐﾂﾋﾞｼﾕｰｴﾌｼﾞｴｲ", kind: "bank", score: 1, matchedOn: "name" }],
      },
      branch: {
        bankCode: "0005",
        query: "新宿支店",
        canonical: "新宿",
        confident: true,
        candidates: [{ code: "341", name: "新宿", kana: "シンジユク", kanaHalfWidth: "ｼﾝｼﾞﾕｸ", score: 1, matchedOn: "name" }],
      },
      best: { bankCode: "0005", bankName: "三菱ＵＦＪ", branchCode: "341", branchName: "新宿", confident: true },
    },
  },
  {
    key: "GET /v1/jp/bank/lookup",
    method: "GET",
    path: "/v1/jp/bank/lookup",
    kind: "query",
    price: "$0.005",
    summary: "Look up a Japanese bank / branch by code",
    description: "Exact lookup of 金融機関コード (and optional 支店コード) → official names, kana, half-width kana, romaji and institution kind.",
    tags: ["japan", "bank", "branch", "zengin", "lookup"],
    input: { bankCode: "0001", branchCode: "001" },
    inputSchema: BANK_LOOKUP_INPUT_SCHEMA,
    outputExample: {
      bank: { code: "0001", name: "みずほ", kana: "ミズホ", kanaHalfWidth: "ﾐｽﾞﾎ", hira: "みずほ", roma: "mizuho", kind: "bank", branchCount: 494 },
      branch: { code: "001", name: "東京営業部", kana: "トウキヨウ", kanaHalfWidth: "ﾄｳｷﾖｳ", hira: "とうきよう", roma: "toukiyou" },
    },
  },
  {
    key: "POST /v1/address/normalize",
    method: "POST",
    path: "/v1/address/normalize",
    kind: "body",
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
    kind: "body",
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
    kind: "body",
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
