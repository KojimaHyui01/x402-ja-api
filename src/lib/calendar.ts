import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Japanese public holidays and business-day arithmetic.
 * Holiday data: 内閣府 official CSV bundled as data/holidays.json (refresh: scripts/update-holidays.ts).
 * All dates are ISO "YYYY-MM-DD" strings; arithmetic is done in UTC to stay timezone-free.
 */

export type CalendarKind = "standard" | "bank";

export interface Holiday {
  date: string;
  name: string;
}

export interface DateDescription {
  date: string;
  weekday: string;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  isBusinessDay: boolean;
  calendar: CalendarKind;
  nextBusinessDay: string;
  previousBusinessDay: string;
}

interface HolidayFile {
  from: string;
  to: string;
  fetchedAt: string;
  holidays: Record<string, string>;
}

export class CalendarInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarInputError";
  }
}

const DATA: HolidayFile = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../data/holidays.json", import.meta.url)), "utf8"),
) as HolidayFile;

export const HOLIDAY_DATA_RANGE = Object.freeze({
  from: DATA.from,
  to: DATA.to,
  fetchedAt: DATA.fetchedAt,
  fromYear: Number(DATA.from.slice(0, 4)),
  toYear: Number(DATA.to.slice(0, 4)),
});

const MAX_OFFSET = 2000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIso(date: string): number {
  const m = ISO_RE.exec(date);
  if (!m) throw new CalendarInputError(`date must be YYYY-MM-DD, got "${date}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new CalendarInputError(`invalid calendar date "${date}"`);
  }
  if (y < HOLIDAY_DATA_RANGE.fromYear || y > HOLIDAY_DATA_RANGE.toYear) {
    throw new CalendarInputError(
      `date must be within ${HOLIDAY_DATA_RANGE.fromYear}-${HOLIDAY_DATA_RANGE.toYear} (holiday data coverage)`,
    );
  }
  return t;
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

function toIso(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const DAY = 86_400_000;

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < HOLIDAY_DATA_RANGE.fromYear || year > HOLIDAY_DATA_RANGE.toYear) {
    throw new CalendarInputError(`year must be an integer within ${HOLIDAY_DATA_RANGE.fromYear}-${HOLIDAY_DATA_RANGE.toYear}`);
  }
}

/** Name of the public holiday on that date, or null. */
export function holidayName(date: string): string | null {
  parseIso(date);
  return DATA.holidays[date] ?? null;
}

export function holidaysInYear(year: number): readonly Holiday[] {
  assertYear(year);
  const prefix = `${year}-`;
  return Object.entries(DATA.holidays)
    .filter(([d]) => d.startsWith(prefix))
    .map(([date, name]) => ({ date, name }));
}

/** Banks in Japan are also closed Dec 31 - Jan 3 (銀行法施行令). */
function isBankClosureDay(iso: string): boolean {
  const md = iso.slice(5);
  return md === "12-31" || md === "01-01" || md === "01-02" || md === "01-03";
}

function isBusinessTs(t: number, calendar: CalendarKind): boolean {
  const dow = new Date(t).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const iso = toIso(t);
  if (DATA.holidays[iso] !== undefined) return false;
  if (calendar === "bank" && isBankClosureDay(iso)) return false;
  return true;
}

export function isBusinessDay(date: string, calendar: CalendarKind = "standard"): boolean {
  return isBusinessTs(parseIso(date), calendar);
}

/**
 * Move n business days from `date`. n>0 forward, n<0 backward.
 * n=0 returns `date` itself if it is a business day, otherwise the next business day.
 */
export function addBusinessDays(date: string, n: number, calendar: CalendarKind = "standard"): string {
  if (!Number.isInteger(n) || Math.abs(n) > MAX_OFFSET) {
    throw new CalendarInputError(`offset must be an integer within ±${MAX_OFFSET}`);
  }
  let t = parseIso(date);
  if (n === 0) {
    while (!isBusinessTs(t, calendar)) t += DAY;
    return toIso(t);
  }
  const step = n > 0 ? DAY : -DAY;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    t += step;
    if (isBusinessTs(t, calendar)) remaining -= 1;
  }
  return toIso(t);
}

export function nextBusinessDay(date: string, calendar: CalendarKind = "standard"): string {
  return addBusinessDays(date, isBusinessDay(date, calendar) ? 1 : 0, calendar);
}

export function previousBusinessDay(date: string, calendar: CalendarKind = "standard"): string {
  return addBusinessDays(date, -1, calendar);
}

export function lastBusinessDayOfMonth(year: number, month: number, calendar: CalendarKind = "standard"): string {
  assertYear(year);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new CalendarInputError("month must be 1-12");
  let t = Date.UTC(year, month, 0); // last day of month
  while (!isBusinessTs(t, calendar)) t -= DAY;
  return toIso(t);
}

/** Number of business days in [from, to). Negative if to < from. */
export function businessDaysBetween(from: string, to: string, calendar: CalendarKind = "standard"): number {
  const a = parseIso(from);
  const b = parseIso(to);
  if (Math.abs(b - a) / DAY > MAX_OFFSET * 7) throw new CalendarInputError("range too large");
  const sign = b >= a ? 1 : -1;
  let count = 0;
  for (let t = Math.min(a, b); t < Math.max(a, b); t += DAY) if (isBusinessTs(t, calendar)) count += 1;
  return sign * count;
}

export function describeDate(date: string, calendar: CalendarKind = "standard"): DateDescription {
  const t = parseIso(date);
  const dow = new Date(t).getUTCDay();
  const name = DATA.holidays[date] ?? null;
  return {
    date,
    weekday: WEEKDAYS[dow]!,
    isWeekend: dow === 0 || dow === 6,
    isHoliday: name !== null,
    holidayName: name,
    isBusinessDay: isBusinessTs(t, calendar),
    calendar,
    nextBusinessDay: addBusinessDays(date, 1, calendar),
    previousBusinessDay: addBusinessDays(date, -1, calendar),
  };
}
