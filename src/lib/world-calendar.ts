import Holidays from "date-holidays";

/**
 * Worldwide public holidays and business-day arithmetic on top of `date-holidays`
 * (ISC code, CC-BY-3.0 data, ~200 countries with regional subdivisions).
 * For Japan the dedicated /v1/jp/* endpoints use the official 内閣府 dataset; this module is the
 * generic engine for everything else (and also covers JP for convenience).
 */

export type HolidayType = "public" | "bank" | "school" | "optional" | "observance";

export interface WorldHoliday {
  date: string;
  name: string;
  localName: string;
  type: HolidayType;
  substitute: boolean;
}

export interface WorldDateDescription {
  country: string;
  region: string | null;
  date: string;
  weekday: string;
  weekend: readonly number[];
  isWeekend: boolean;
  holidays: readonly WorldHoliday[];
  isBusinessDay: boolean;
  nextBusinessDay: string;
  previousBusinessDay: string;
}

export interface BusinessDayOptions {
  region?: string;
  /** JS weekday numbers (0 = Sunday). Defaults to the country's customary weekend. */
  weekend?: readonly number[];
  /** Holiday types that close for business. Default: public (+ bank when "bank"). */
  calendar?: "standard" | "bank";
}

export class WorldCalendarInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldCalendarInputError";
  }
}

const MAX_OFFSET = 2000;
const DAY = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const meta = new Holidays({ languages: ["en"] });
const COUNTRIES: ReadonlyMap<string, string> = new Map(Object.entries(meta.getCountries("en") as Record<string, string>));

/** Customary weekends that differ from Sat/Sun (JS weekday numbers). */
const WEEKENDS: Readonly<Record<string, readonly number[]>> = {
  SA: [5, 6], QA: [5, 6], KW: [5, 6], BH: [5, 6], OM: [5, 6], EG: [5, 6], JO: [5, 6], IQ: [5, 6],
  LY: [5, 6], DZ: [5, 6], SD: [5, 6], YE: [5, 6], SY: [5, 6], BD: [5, 6], IL: [5, 6], MV: [5, 6],
  IR: [5], AF: [5], DJ: [5], NP: [6],
};
const DEFAULT_WEEKEND: readonly number[] = [6, 0];

export function listCountries(): readonly { code: string; name: string }[] {
  return [...COUNTRIES.entries()].map(([code, name]) => ({ code, name })).sort((a, b) => a.code.localeCompare(b.code));
}

function assertCountry(country: string): string {
  const code = country.toUpperCase();
  if (!COUNTRIES.has(code)) throw new WorldCalendarInputError(`unknown country code "${country}" (ISO 3166-1 alpha-2)`);
  return code;
}

export function listRegions(country: string): readonly { code: string; name: string }[] {
  const code = assertCountry(country);
  const states = (meta.getStates(code, "en") ?? {}) as Record<string, string>;
  return Object.entries(states).map(([c, name]) => ({ code: c, name })).sort((a, b) => a.code.localeCompare(b.code));
}

function assertRegion(country: string, region: string | undefined): string | null {
  if (region === undefined || region === "") return null;
  const code = region.toUpperCase();
  if (!listRegions(country).some((r) => r.code === code)) {
    throw new WorldCalendarInputError(`unknown region "${region}" for ${country}`);
  }
  return code;
}

export function weekendFor(country: string): readonly number[] {
  return WEEKENDS[country.toUpperCase()] ?? DEFAULT_WEEKEND;
}

const instances = new Map<string, { en: Holidays; local: Holidays }>();

function instancesFor(country: string, region: string | null): { en: Holidays; local: Holidays } {
  const key = `${country}/${region ?? ""}`;
  const cached = instances.get(key);
  if (cached) return cached;
  const built = region
    ? { en: new Holidays(country, region, { languages: ["en"] }), local: new Holidays(country, region) }
    : { en: new Holidays(country, { languages: ["en"] }), local: new Holidays(country) };
  instances.set(key, built);
  return built;
}

const holidayCache = new Map<string, readonly WorldHoliday[]>();

function rawHolidays(country: string, region: string | null, year: number): readonly WorldHoliday[] {
  const key = `${country}/${region ?? ""}/${year}`;
  const cached = holidayCache.get(key);
  if (cached) return cached;
  const { en, local } = instancesFor(country, region);
  const localByKey = new Map(local.getHolidays(year).map((h) => [`${h.date}|${h.rule}`, h.name]));
  const out: WorldHoliday[] = [];
  for (const h of en.getHolidays(year)) {
    // multi-day holidays (start..end) expand to one entry per day
    const days = Math.max(1, Math.round((h.end.getTime() - h.start.getTime()) / DAY));
    const first = h.date.slice(0, 10);
    for (let i = 0; i < days; i += 1) {
      const t = Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, Number(first.slice(8, 10))) + i * DAY;
      out.push({
        date: toIso(t),
        name: h.name,
        localName: localByKey.get(`${h.date}|${h.rule}`) ?? h.name,
        type: h.type as HolidayType,
        substitute: Boolean(h.substitute),
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  holidayCache.set(key, out);
  return out;
}

export function holidaysFor(
  country: string,
  year: number,
  opts: { region?: string; types?: readonly HolidayType[] } = {},
): readonly WorldHoliday[] {
  const c = assertCountry(country);
  const r = assertRegion(c, opts.region);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new WorldCalendarInputError("year must be 1900-2100");
  const list = rawHolidays(c, r, year);
  return opts.types ? list.filter((h) => opts.types!.includes(h.type)) : list;
}

// ---------- business-day engine ----------

const pad2 = (n: number): string => String(n).padStart(2, "0");

function toIso(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function parseIso(date: string): number {
  const m = ISO_RE.exec(date);
  if (!m) throw new WorldCalendarInputError(`date must be YYYY-MM-DD, got "${date}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new WorldCalendarInputError(`invalid calendar date "${date}"`);
  }
  if (y < 1900 || y > 2100) throw new WorldCalendarInputError("date must be within 1900-2100");
  return t;
}

interface Engine {
  country: string;
  region: string | null;
  weekend: readonly number[];
  closingTypes: ReadonlySet<HolidayType>;
}

function engineFor(country: string, opts: BusinessDayOptions): Engine {
  const c = assertCountry(country);
  const r = assertRegion(c, opts.region);
  const weekend = opts.weekend ?? weekendFor(c);
  if (weekend.some((d) => !Number.isInteger(d) || d < 0 || d > 6) || weekend.length > 6) {
    throw new WorldCalendarInputError("weekend must be a list of weekday numbers 0-6");
  }
  const closingTypes = new Set<HolidayType>(opts.calendar === "bank" ? ["public", "bank"] : ["public"]);
  return { country: c, region: r, weekend, closingTypes };
}

function closedHolidays(e: Engine, iso: string): readonly WorldHoliday[] {
  return rawHolidays(e.country, e.region, Number(iso.slice(0, 4))).filter((h) => h.date === iso && e.closingTypes.has(h.type));
}

function isBusinessTs(e: Engine, t: number): boolean {
  if (e.weekend.includes(new Date(t).getUTCDay())) return false;
  return closedHolidays(e, toIso(t)).length === 0;
}

function step(e: Engine, from: number, n: number): string {
  let t = from;
  if (n === 0) {
    while (!isBusinessTs(e, t)) t += DAY;
    return toIso(t);
  }
  const delta = n > 0 ? DAY : -DAY;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    t += delta;
    if (isBusinessTs(e, t)) remaining -= 1;
  }
  return toIso(t);
}

export function addBusinessDaysIn(country: string, date: string, n: number, opts: BusinessDayOptions = {}): string {
  if (!Number.isInteger(n) || Math.abs(n) > MAX_OFFSET) throw new WorldCalendarInputError(`offset must be an integer within ±${MAX_OFFSET}`);
  return step(engineFor(country, opts), parseIso(date), n);
}

export function describeDateIn(country: string, date: string, opts: BusinessDayOptions = {}): WorldDateDescription {
  const e = engineFor(country, opts);
  const t = parseIso(date);
  const dow = new Date(t).getUTCDay();
  const all = rawHolidays(e.country, e.region, Number(date.slice(0, 4))).filter((h) => h.date === date);
  return {
    country: e.country,
    region: e.region,
    date,
    weekday: WEEKDAYS[dow]!,
    weekend: e.weekend,
    isWeekend: e.weekend.includes(dow),
    holidays: all,
    isBusinessDay: isBusinessTs(e, t),
    nextBusinessDay: step(e, t, 1),
    previousBusinessDay: step(e, t, -1),
  };
}
