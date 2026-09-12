import { HojinClient, KIND_LABELS, isValidCorporateNumber, type RawCorporation } from "./hojin.js";
import { toHalfWidth } from "./text.js";

export interface CompanyAddress {
  prefecture: string;
  city: string;
  street: string;
  postCode: string;
  prefectureCode: string;
  cityCode: string;
  formatted: string;
}

export interface CompanyCandidate {
  corporateNumber: string;
  /** 適格請求書発行事業者 登録番号 format ("T" + 法人番号). Registration status is NOT verified here. */
  invoiceNumberFormat: string;
  name: string;
  furigana: string;
  englishName: string;
  kind: string;
  kindLabel: string;
  address: CompanyAddress;
  closed: boolean;
  closeDate: string | null;
  successorCorporateNumber: string | null;
  assignmentDate: string;
  updateDate: string;
  /** true when the candidate's normalized name equals the normalized query */
  exactNameMatch: boolean;
}

export interface CompanyResolution {
  query: string;
  matchedBy: "number" | "name";
  lastUpdateDate: string;
  totalCount: number;
  candidates: readonly CompanyCandidate[];
}

export const MAX_CANDIDATES = 10;
export const MAX_QUERY_LENGTH = 100;

export class CompanyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyInputError";
  }
}

const LEGAL_FORM_RE =
  /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|学校法人|社会福祉法人|特定非営利活動法人|\(株\)|\(有\)|\(同\)|㈱|㈲)/g;

/** Comparable form of a company name: half-width, no legal form, no spaces/punctuation. */
export function normalizeCompanyName(name: string): string {
  return toHalfWidth(name).replace(LEGAL_FORM_RE, "").replace(/[\s・,.．、。]/g, "").toLowerCase();
}

function toCandidate(raw: RawCorporation, normalizedQuery: string): CompanyCandidate {
  const street = toHalfWidth(raw.streetNumber).replace(/\s+/g, "");
  return {
    corporateNumber: raw.corporateNumber,
    invoiceNumberFormat: `T${raw.corporateNumber}`,
    name: raw.name,
    furigana: raw.furigana,
    englishName: raw.enName,
    kind: raw.kind,
    kindLabel: KIND_LABELS[raw.kind] ?? "不明",
    address: {
      prefecture: raw.prefectureName,
      city: raw.cityName,
      street,
      postCode: raw.postCode,
      prefectureCode: raw.prefectureCode,
      cityCode: raw.cityCode,
      formatted: `${raw.prefectureName}${raw.cityName}${street}`,
    },
    closed: raw.closeDate !== "",
    closeDate: raw.closeDate || null,
    successorCorporateNumber: raw.successorCorporateNumber || null,
    assignmentDate: raw.assignmentDate,
    updateDate: raw.updateDate,
    exactNameMatch: normalizeCompanyName(raw.name) === normalizedQuery,
  };
}

function rank(a: CompanyCandidate, b: CompanyCandidate): number {
  if (a.exactNameMatch !== b.exactNameMatch) return a.exactNameMatch ? -1 : 1;
  if (a.closed !== b.closed) return a.closed ? 1 : -1;
  return b.updateDate.localeCompare(a.updateDate);
}

/** Resolve a 13-digit corporate number or a (possibly fuzzy) company name. */
export async function resolveCompany(
  client: HojinClient,
  query: string,
  opts: { prefectureCode?: string } = {},
): Promise<CompanyResolution> {
  const q = toHalfWidth(query).trim();
  if (q.length === 0) throw new CompanyInputError("query must not be empty");
  if (q.length > MAX_QUERY_LENGTH) {
    throw new CompanyInputError(`query must be at most ${MAX_QUERY_LENGTH} characters`);
  }

  const digits = q.replace(/^T/i, "").replace(/[-\s]/g, "");
  if (/^\d{13}$/.test(digits)) {
    if (!isValidCorporateNumber(digits)) {
      throw new CompanyInputError(`invalid corporate number check digit: ${digits}`);
    }
    const res = await client.byNumber([digits]);
    return {
      query: q,
      matchedBy: "number",
      lastUpdateDate: res.header.lastUpdateDate,
      totalCount: res.header.count,
      candidates: res.corporations.map((c) => toCandidate(c, normalizeCompanyName(c.name))),
    };
  }

  const res = await client.byName(q, { mode: 2, target: 1, prefectureCode: opts.prefectureCode });
  const normalizedQuery = normalizeCompanyName(q);
  const candidates = res.corporations
    .filter((c) => c.hihyoji !== "1")
    .map((c) => toCandidate(c, normalizedQuery))
    .sort(rank)
    .slice(0, MAX_CANDIDATES);
  return {
    query: q,
    matchedBy: "name",
    lastUpdateDate: res.header.lastUpdateDate,
    totalCount: res.header.count,
    candidates,
  };
}
