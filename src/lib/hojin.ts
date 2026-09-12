import { parseCsv } from "./csv.js";

/**
 * Client for 国税庁 法人番号システム Web-API v4.
 * Spec: https://www.houjin-bangou.nta.go.jp/webapi/  (CSV/Unicode = type 02)
 */

export const HOJIN_API_BASE = "https://api.houjin-bangou.nta.go.jp/4";

/** Column order of a v4 CSV data row (30 fields). */
const COLUMNS = [
  "sequenceNumber", "corporateNumber", "process", "correct", "updateDate", "changeDate",
  "name", "nameImageId", "kind", "prefectureName", "cityName", "streetNumber",
  "addressImageId", "prefectureCode", "cityCode", "postCode", "addressOutside",
  "addressOutsideImageId", "closeDate", "closeCause", "successorCorporateNumber",
  "changeCause", "assignmentDate", "latest", "enName", "enPrefectureName", "enCityName",
  "enAddressOutside", "furigana", "hihyoji",
] as const;

type Column = (typeof COLUMNS)[number];
export type RawCorporation = Readonly<Record<Column, string>>;

export interface HojinHeader {
  lastUpdateDate: string;
  count: number;
  divideNumber: number;
  divideSize: number;
}

export interface HojinResponse {
  header: HojinHeader;
  corporations: readonly RawCorporation[];
}

/** 法人種別 (kind) codes from the NTA resource definition. */
export const KIND_LABELS: Readonly<Record<string, string>> = {
  "101": "国の機関",
  "201": "地方公共団体",
  "301": "株式会社",
  "302": "有限会社",
  "303": "合名会社",
  "304": "合資会社",
  "305": "合同会社",
  "399": "その他の設立登記法人",
  "401": "外国会社等",
  "499": "その他",
};

export class HojinParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HojinParseError";
  }
}

export class HojinApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HojinApiError";
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parse a v4 CSV body (header line + data rows) into typed records. */
export function parseHojinCsv(body: string): HojinResponse {
  const rows = parseCsv(stripBom(body)).filter((r) => r.length > 1 || (r[0] ?? "") !== "");
  const head = rows[0];
  if (!head || head.length < 4) throw new HojinParseError("missing header line");
  const header: HojinHeader = {
    lastUpdateDate: head[0] ?? "",
    count: Number(head[1]),
    divideNumber: Number(head[2]),
    divideSize: Number(head[3]),
  };
  if ([header.count, header.divideNumber, header.divideSize].some(Number.isNaN)) {
    throw new HojinParseError(`invalid header line: ${head.join(",")}`);
  }
  const corporations = rows.slice(1).map((r, idx) => {
    if (r.length !== COLUMNS.length) {
      throw new HojinParseError(`row ${idx + 2}: expected ${COLUMNS.length} fields, got ${r.length}`);
    }
    return Object.fromEntries(COLUMNS.map((c, i) => [c, r[i] ?? ""])) as RawCorporation;
  });
  return { header, corporations };
}

export interface NameSearchOptions {
  /** 1 = prefix match, 2 = partial match (default) */
  mode?: 1 | 2;
  /** 1 = fuzzy (JIS1-2, ignores 法人種別 etc., default), 2 = exact, 3 = English name */
  target?: 1 | 2 | 3;
  /** 2-digit JIS prefecture code, e.g. "13" */
  prefectureCode?: string;
  /** Include historical (renamed/closed) records. Default false. */
  includeHistory?: boolean;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class HojinClient {
  constructor(
    private readonly appId: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl: string = HOJIN_API_BASE,
  ) {}

  private async request(path: string, params: Record<string, string>): Promise<HojinResponse> {
    const qs = new URLSearchParams({ id: this.appId, type: "02", ...params });
    const url = `${this.baseUrl}/${path}?${qs.toString()}`;
    const res = await this.fetchImpl(url, { headers: { "User-Agent": "x402-ja-api/0.1" } });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      throw new HojinApiError(`NTA API ${res.status}: ${detail}`, res.status);
    }
    return parseHojinCsv(await res.text());
  }

  /** Look up by 13-digit corporate number(s), max 10. */
  byNumber(numbers: readonly string[], includeHistory = false): Promise<HojinResponse> {
    if (numbers.length === 0 || numbers.length > 10) {
      return Promise.reject(new RangeError("byNumber accepts 1-10 corporate numbers"));
    }
    return this.request("num", { number: numbers.join(","), history: includeHistory ? "1" : "0" });
  }

  /** Search by corporate name. */
  byName(name: string, opts: NameSearchOptions = {}): Promise<HojinResponse> {
    const params: Record<string, string> = {
      name,
      mode: String(opts.mode ?? 2),
      target: String(opts.target ?? 1),
      change: opts.includeHistory ? "1" : "0",
      close: "1",
    };
    if (opts.prefectureCode) params.address = opts.prefectureCode;
    return this.request("name", params);
  }
}

/**
 * Corporate-number check digit per 国税庁 spec:
 * check = 9 - ((Σ even-position digits × 1 + Σ odd-position digits × 2) mod 9),
 * positions counted from the right over the 12 body digits.
 */
export function isValidCorporateNumber(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const check = Number(value[0]);
  const body = value.slice(1).split("").map(Number);
  const sum = body.reduce((acc, d, i) => {
    const positionFromRight = 12 - i; // 12..1
    return acc + d * (positionFromRight % 2 === 0 ? 2 : 1);
  }, 0);
  return check === 9 - (sum % 9);
}
