import { createRequire } from "node:module";
import type { ZenginBank, ZenginBranch } from "zengin-code";

/**
 * Japanese bank / branch code resolution on top of zengin-code (MIT, auto-updated from public sources).
 * zengin naming: banks without 銀行 ("みずほ"), 信用金庫 as "〇〇信金", 信用組合 "〇〇信組", 労働金庫 "〇〇労金",
 * JA as "〇〇農協"; branches without 支店 but with 出張所; kana is 全銀 style (no small kana, 長音 = "－").
 */

const require = createRequire(import.meta.url);
const ZENGIN = require("zengin-code") as Record<string, ZenginBank>;

export type InstitutionKind =
  | "bank"
  | "shinkin"
  | "shinkumi"
  | "rokin"
  | "norinchukin-shinren"
  | "ja-jf"
  | "jp-bank"
  | "other";

export interface BankInfo {
  code: string;
  name: string;
  kana: string;
  kanaHalfWidth: string;
  hira: string;
  roma: string;
  kind: InstitutionKind;
  branchCount: number;
}

export interface BranchInfo {
  code: string;
  name: string;
  kana: string;
  kanaHalfWidth: string;
  hira: string;
  roma: string;
}

export interface Candidate<T> {
  score: number;
  matchedOn: "name" | "kana" | "roma" | "prefix" | "contains" | "similar";
  entity: T;
}

export interface Resolution<T> {
  query: string;
  canonical: string;
  confident: boolean;
  candidates: readonly (T & { score: number; matchedOn: Candidate<T>["matchedOn"] })[];
}

export const MAX_QUERY_LENGTH = 100;
export const MAX_CANDIDATES = 5;

export class BankInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankInputError";
  }
}

// ---------- canonical forms ----------

const KANJI_DIGITS: Readonly<Record<string, string>> = {
  〇: "0", 零: "0", 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9",
};

function kanjiNumeralsToDigits(s: string): string {
  return s.replace(/[〇零一二三四五六七八九]/g, (c) => KANJI_DIGITS[c] ?? c);
}

const INSTITUTION_SUFFIXES: readonly (readonly [RegExp, string])[] = [
  [/信用農業協同組合連合会$/, "信連"],
  [/農業協同組合$/, "農協"],
  [/漁業協同組合$/, "漁協"],
  [/信用金庫$/, "信金"],
  [/信用組合$/, "信組"],
  [/労働金庫$/, "労金"],
  [/銀行$/, ""],
];

/** Bank name → zengin-style name (NFKC, no 株式会社, 銀行 dropped, 信用金庫→信金, JA〇〇→〇〇農協). */
export function canonicalBankName(input: string): string {
  let s = input.normalize("NFKC").replace(/[\s　]/g, "").replace(/^(株式会社|\(株\))|(株式会社|\(株\))$/g, "");
  const ja = /^JA(.+)$/i.exec(s);
  if (ja) s = /(農協|農業協同組合)$/.test(ja[1]!) ? ja[1]! : `${ja[1]}農協`;
  for (const [re, rep] of INSTITUTION_SUFFIXES) {
    if (re.test(s)) {
      s = s.replace(re, rep);
      break;
    }
  }
  return s;
}

/** Branch name → zengin-style (NFKC, 支店 dropped, 出張所 kept, kanji numerals → digits). */
export function canonicalBranchName(input: string): string {
  const s = input.normalize("NFKC").replace(/[\s　]/g, "").replace(/支店$/, "");
  return kanjiNumeralsToDigits(s);
}

const SMALL_TO_LARGE: Readonly<Record<string, string>> = {
  ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ッ: "ツ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ヮ: "ワ", ヵ: "カ", ヶ: "ケ",
};

/** Kana → zengin comparison form: katakana, large kana only, no long-vowel marks / separators. */
export function canonicalKana(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[ァィゥェォッャュョヮヵヶ]/g, (c) => SMALL_TO_LARGE[c] ?? c)
    .replace(/[ー－\-\s　・･]/g, "");
}

// ---------- half-width kana (全銀フォーマット) ----------

const FULL_TO_HALF: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (let cp = 0xff61; cp <= 0xff9f; cp += 1) {
    const half = String.fromCharCode(cp);
    map[half.normalize("NFKC")] = half;
  }
  map["゙"] = "ﾞ"; // combining dakuten
  map["゚"] = "ﾟ"; // combining handakuten
  map["ー"] = "ｰ";
  map["－"] = "ｰ";
  map["-"] = "ｰ";
  map["・"] = "･";
  return map;
})();

/** Full-width katakana → JIS X 0201 half-width kana (ガ → ｶﾞ), as used in 全銀 transfer files. */
export function toHalfWidthKana(input: string): string {
  return Array.from(input.normalize("NFD"), (c) => FULL_TO_HALF[c] ?? c).join("");
}

// ---------- classification ----------

export function institutionKind(code: string): InstitutionKind {
  if (code === "9900") return "jp-bank";
  const n = Number(code);
  if (n === 2004) return "other"; // 商工中金
  if (n < 1000) return "bank";
  if (n < 2000) return "shinkin";
  if (n >= 2950 && n <= 2999) return "rokin";
  if (n < 3000) return "shinkumi";
  if (n < 4000) return "norinchukin-shinren";
  if (n < 9900) return "ja-jf";
  return "other";
}

// ---------- indexes ----------

interface Indexed<T> {
  entity: T;
  canonName: string;
  canonKana: string;
  roma: string;
}

function toBankInfo(b: ZenginBank): BankInfo {
  return {
    code: b.code,
    name: b.name,
    kana: b.kana,
    kanaHalfWidth: toHalfWidthKana(b.kana),
    hira: b.hira,
    roma: b.roma,
    kind: institutionKind(b.code),
    branchCount: Object.keys(b.branches).length,
  };
}

function toBranchInfo(b: ZenginBranch): BranchInfo {
  return { code: b.code, name: b.name, kana: b.kana, kanaHalfWidth: toHalfWidthKana(b.kana), hira: b.hira, roma: b.roma };
}

const BANK_INDEX: readonly Indexed<BankInfo>[] = Object.values(ZENGIN)
  .sort((a, b) => a.code.localeCompare(b.code))
  .map((b) => ({
    entity: toBankInfo(b),
    canonName: b.name.normalize("NFKC").toLowerCase(),
    canonKana: canonicalKana(b.kana),
    roma: b.roma.toLowerCase(),
  }));

const BRANCH_INDEX = new Map<string, readonly Indexed<BranchInfo>[]>();

function branchIndex(bankCode: string): readonly Indexed<BranchInfo>[] {
  const cached = BRANCH_INDEX.get(bankCode);
  if (cached) return cached;
  const bank = ZENGIN[bankCode];
  if (!bank) throw new BankInputError(`unknown bank code ${bankCode}`);
  const built = Object.values(bank.branches)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((br) => ({
      entity: toBranchInfo(br),
      canonName: kanjiNumeralsToDigits(br.name.normalize("NFKC")).toLowerCase(),
      canonKana: canonicalKana(br.kana),
      roma: br.roma.toLowerCase(),
    }));
  BRANCH_INDEX.set(bankCode, built);
  return built;
}

// ---------- matching ----------

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i += 1) out.add(s.slice(i, i + 2));
  return out;
}

function dice(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}

function scoreEntry<T>(e: Indexed<T>, qName: string, qKana: string, qRoma: string): Candidate<T> | null {
  if (qName !== "" && e.canonName === qName) return { score: 1, matchedOn: "name", entity: e.entity };
  if (qKana !== "" && e.canonKana === qKana) return { score: 0.98, matchedOn: "kana", entity: e.entity };
  if (qRoma !== "" && e.roma === qRoma) return { score: 0.95, matchedOn: "roma", entity: e.entity };
  if (qName.length >= 2 && (e.canonName.startsWith(qName) || qName.startsWith(e.canonName))) {
    return { score: 0.8, matchedOn: "prefix", entity: e.entity };
  }
  if (qKana.length >= 2 && e.canonKana.startsWith(qKana)) return { score: 0.78, matchedOn: "prefix", entity: e.entity };
  if (qName.length >= 2 && e.canonName.includes(qName)) return { score: 0.7, matchedOn: "contains", entity: e.entity };
  const sim = Math.max(dice(e.canonName, qName), dice(e.canonKana, qKana));
  if (sim >= 0.5) return { score: Math.round(sim * 0.6 * 100) / 100, matchedOn: "similar", entity: e.entity };
  return null;
}

function rank<T extends { code: string }>(
  index: readonly Indexed<T>[],
  query: string,
  canonical: string,
): Resolution<T> {
  const qName = canonical.toLowerCase();
  const qKana = canonicalKana(query);
  const qRoma = query.normalize("NFKC").trim().toLowerCase();
  const scored = index
    .map((e) => scoreEntry(e, qName, qKana, qRoma))
    .filter((c): c is Candidate<T> => c !== null)
    .sort((a, b) => b.score - a.score || a.entity.code.localeCompare(b.entity.code))
    .slice(0, MAX_CANDIDATES);
  const top = scored[0]?.score ?? 0;
  const second = scored[1]?.score ?? 0;
  return {
    query,
    canonical,
    confident: top >= 0.9 && top - second >= 0.15,
    candidates: scored.map((c) => ({ ...c.entity, score: c.score, matchedOn: c.matchedOn })),
  };
}

function assertQuery(q: string): string {
  const s = q.trim();
  if (s.length === 0) throw new BankInputError("query must not be empty");
  if (s.length > MAX_QUERY_LENGTH) throw new BankInputError(`query must be at most ${MAX_QUERY_LENGTH} characters`);
  return s;
}

/** Fuzzy-resolve a bank / 信金 / 信組 / 労金 / JA name to zengin bank codes. */
export function resolveBank(query: string): Resolution<BankInfo> {
  const q = assertQuery(query);
  return rank(BANK_INDEX, q, canonicalBankName(q));
}

/** Fuzzy-resolve a branch name within one bank. */
export function resolveBranch(bankCode: string, query: string): Resolution<BranchInfo> {
  if (!/^\d{4}$/.test(bankCode)) throw new BankInputError("bankCode must be 4 digits");
  const q = assertQuery(query);
  return rank(branchIndex(bankCode), q, canonicalBranchName(q));
}

/** Exact lookup by codes. Returns null when the bank code is unknown; branch is null when not found. */
export function lookupBank(bankCode: string, branchCode?: string): { bank: BankInfo; branch: BranchInfo | null } | null {
  if (!/^\d{4}$/.test(bankCode)) throw new BankInputError("bankCode must be 4 digits");
  if (branchCode !== undefined && !/^\d{3}$/.test(branchCode)) throw new BankInputError("branchCode must be 3 digits");
  const bank = ZENGIN[bankCode];
  if (!bank) return null;
  const branch = branchCode !== undefined ? bank.branches[branchCode] : undefined;
  return { bank: toBankInfo(bank), branch: branch ? toBranchInfo(branch) : null };
}

export const BANK_DATA_INFO = Object.freeze({
  banks: BANK_INDEX.length,
  branches: Object.values(ZENGIN).reduce((n, b) => n + Object.keys(b.branches).length, 0),
  source: "zengin-code (https://github.com/zengin-code/source-data), MIT",
  version: (require("zengin-code/package.json") as { version: string }).version,
});
