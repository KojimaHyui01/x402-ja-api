/**
 * Pure text-normalization helpers for Japanese business text.
 * Every function returns new values; nothing mutates its input.
 */

export interface WarekiDate {
  original: string;
  iso: string;
}

export interface PhoneNumber {
  original: string;
  e164: string;
  national: string;
}

export interface NormalizedText {
  normalized: string;
  dates: readonly WarekiDate[];
  phones: readonly PhoneNumber[];
  postalCodes: readonly string[];
  emails: readonly string[];
}

/** Year preceding year 1 of each era (era year 1 = base + 1). */
const ERA_BASE_YEAR: Readonly<Record<string, number>> = {
  明治: 1867, M: 1867,
  大正: 1911, T: 1911,
  昭和: 1925, S: 1925,
  平成: 1988, H: 1988,
  令和: 2018, R: 2018,
};

const WAREKI_RE =
  /(?<![A-Za-z])(明治|大正|昭和|平成|令和|[MTSHR])\s*(元|\d{1,2})\s*[年./]\s*(\d{1,2})\s*[月./]\s*(\d{1,2})\s*日?/g;

const PHONE_RE =
  /(?<!\d)(\+81[\s-]?(?:\(0\))?|0)(\d{1,4})[\s\-‐−ー]?(\d{1,4})[\s\-‐−ー]?(\d{3,4})(?!\d)/g;

const POSTAL_RE = /〒\s?(\d{3})[-‐−]?(\d{4})(?!\d)|(?<!\d)(\d{3})[-‐−](\d{4})(?!\d)/g;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Full-width ASCII → half-width, half-width kana → full-width, ㈱ → (株), 　 → space. */
export function toHalfWidth(input: string): string {
  return input.normalize("NFKC");
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * Replace 和暦 dates (令和5年4月1日 / R5.4.1 / H31/4/30) with ISO-8601 dates.
 * Input is half-width-normalized first, so `text` and `original` are in half-width form.
 */
export function convertWareki(input: string): { text: string; dates: readonly WarekiDate[] } {
  const dates: WarekiDate[] = [];
  const text = toHalfWidth(input).replace(WAREKI_RE, (original, era: string, y: string, m: string, d: string) => {
    const year = ERA_BASE_YEAR[era] + (y === "元" ? 1 : Number(y));
    const month = Number(m);
    const day = Number(d);
    if (!isValidDate(year, month, day)) return original;
    const iso = `${year}-${pad2(month)}-${pad2(day)}`;
    dates.push({ original, iso });
    return iso;
  });
  return { text, dates };
}

/** Find Japanese phone numbers and return them in E.164 and national forms. */
export function extractPhones(input: string): readonly PhoneNumber[] {
  const out: PhoneNumber[] = [];
  for (const m of toHalfWidth(input).matchAll(PHONE_RE)) {
    const [original, , a, b, c] = m;
    const subscriber = `${a}${b}${c}`;
    const national = `0${subscriber}`;
    if (!/^0\d{9,10}$/.test(national)) continue;
    out.push({ original, e164: `+81${national.slice(1)}`, national });
  }
  return out;
}

/** Find 7-digit postal codes written as 〒1000001, 〒100-0001 or 100-0001. */
export function extractPostalCodes(input: string): readonly string[] {
  const out: string[] = [];
  for (const m of toHalfWidth(input).matchAll(POSTAL_RE)) {
    const head = m[1] ?? m[3];
    const tail = m[2] ?? m[4];
    out.push(`${head}${tail}`);
  }
  return out;
}

export function extractEmails(input: string): readonly string[] {
  return Array.from(toHalfWidth(input).matchAll(EMAIL_RE), (m) => m[0]);
}

function collapseWhitespace(input: string): string {
  return input.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

/** One-shot normalization: half-width, ISO dates, and extracted contact fields. */
export function normalizeText(input: string): NormalizedText {
  const { text, dates } = convertWareki(input);
  return {
    normalized: collapseWhitespace(text),
    dates,
    phones: extractPhones(input),
    postalCodes: extractPostalCodes(input),
    emails: extractEmails(input),
  };
}
