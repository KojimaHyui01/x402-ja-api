import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AddressInputError, normalizeAddress } from "../lib/address.js";
import { BankInputError, lookupBank, resolveBank, resolveBranch } from "../lib/bank.js";
import {
  CalendarInputError,
  HOLIDAY_DATA_RANGE,
  addBusinessDays,
  describeDate,
  holidaysInYear,
  lastBusinessDayOfMonth,
  type CalendarKind,
} from "../lib/calendar.js";
import { CompanyInputError, resolveCompany } from "../lib/company.js";
import { HojinApiError, HojinClient, HojinParseError } from "../lib/hojin.js";
import { NameInputError, parseName } from "../lib/name.js";
import { RomajiInputError, kanaToRomaji, romanizeName } from "../lib/romaji.js";
import { normalizeText } from "../lib/text.js";
import {
  WorldCalendarInputError,
  addBusinessDaysIn,
  describeDateIn,
  holidaysFor,
  type HolidayType,
} from "../lib/world-calendar.js";

const AddressBody = z.object({
  address: z.string().min(1).max(200),
  level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(8)]).default(8),
});

const TextBody = z.object({
  text: z.string().min(1).max(20_000),
});

const CompanyBody = z.object({
  query: z.string().min(1).max(100),
  prefectureCode: z.string().regex(/^[0-4][0-9]$/).optional(),
});

const HolidaysQuery = z.object({
  year: z.coerce.number().int().min(HOLIDAY_DATA_RANGE.fromYear).max(HOLIDAY_DATA_RANGE.toYear),
});

const BusinessDayQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  add: z.coerce.number().int().min(-2000).max(2000).default(0),
  calendar: z.enum(["standard", "bank"]).default("standard"),
});

const BankResolveQuery = z.object({
  bank: z.string().min(1).max(100),
  branch: z.string().min(1).max(100).optional(),
});

const BankLookupQuery = z.object({
  bankCode: z.string().regex(/^\d{4}$/),
  branchCode: z.string().regex(/^\d{3}$/).optional(),
});

const NameParseQuery = z.object({
  name: z.string().min(1).max(40),
  kana: z.string().min(1).max(100).optional(),
});

const NameRomajiQuery = z.object({
  kana: z.string().min(1).max(100),
});

const HOLIDAY_TYPES = ["public", "bank", "school", "optional", "observance"] as const;

const csv = (v: string): string[] => v.split(",").map((t) => t.trim()).filter((t) => t !== "");

const WorldHolidaysQuery = z.object({
  country: z.string().regex(/^[A-Za-z]{2}$/),
  year: z.coerce.number().int().min(1900).max(2100),
  region: z.string().max(10).optional(),
  types: z.string().transform(csv).pipe(z.array(z.enum(HOLIDAY_TYPES)).min(1)).optional(),
});

const WorldBusinessDayQuery = z.object({
  country: z.string().regex(/^[A-Za-z]{2}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  add: z.coerce.number().int().min(-2000).max(2000).default(0),
  region: z.string().max(10).optional(),
  weekend: z
    .string()
    .transform((v) => csv(v).map(Number))
    .pipe(z.array(z.number().int().min(0).max(6)).max(6))
    .optional(),
  calendar: z.enum(["standard", "bank"]).default("standard"),
});

/** Today's date in Japan (UTC+9), as YYYY-MM-DD. */
function todayJst(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

interface ApiDeps {
  hojin: HojinClient | null;
}

function badRequest(res: Response, message: string, details?: unknown): void {
  res.status(400).json({ error: "bad_request", message, details });
}

function parseBody<S extends z.ZodTypeAny>(schema: S, req: Request, res: Response): z.output<S> | null {
  const parsed = schema.safeParse(req.body);
  if (parsed.success) return parsed.data;
  badRequest(res, "invalid request body", parsed.error.flatten());
  return null;
}

function parseQuery<S extends z.ZodTypeAny>(schema: S, req: Request, res: Response): z.output<S> | null {
  const parsed = schema.safeParse(req.query);
  if (parsed.success) return parsed.data;
  badRequest(res, "invalid query parameters", parsed.error.flatten());
  return null;
}

const HOLIDAY_SOURCE = "内閣府 https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html";

function businessDayReport(date: string, add: number, calendar: CalendarKind) {
  const [y, m] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  return {
    ...describeDate(date, calendar),
    add,
    result: addBusinessDays(date, add, calendar),
    lastBusinessDayOfMonth: lastBusinessDayOfMonth(y, m, calendar),
  };
}

/** Paid endpoints. Payment enforcement happens in middleware mounted before this router. */
export function apiRouter(deps: ApiDeps): Router {
  const router = Router();

  router.get("/v1/holidays", (req, res) => {
    const q = parseQuery(WorldHolidaysQuery, req, res);
    if (!q) return;
    try {
      const holidays = holidaysFor(q.country, q.year, { region: q.region, types: q.types as readonly HolidayType[] | undefined });
      res.json({
        country: q.country.toUpperCase(),
        region: q.region?.toUpperCase() ?? null,
        year: q.year,
        count: holidays.length,
        holidays,
        source: "date-holidays (CC-BY-3.0)",
      });
    } catch (err) {
      if (err instanceof WorldCalendarInputError) return badRequest(res, err.message);
      throw err;
    }
  });

  router.get("/v1/business-day", (req, res) => {
    const q = parseQuery(WorldBusinessDayQuery, req, res);
    if (!q) return;
    try {
      const date = q.date ?? new Date().toISOString().slice(0, 10);
      const opts = { region: q.region, weekend: q.weekend, calendar: q.calendar };
      res.json({ ...describeDateIn(q.country, date, opts), add: q.add, result: addBusinessDaysIn(q.country, date, q.add, opts) });
    } catch (err) {
      if (err instanceof WorldCalendarInputError) return badRequest(res, err.message);
      throw err;
    }
  });

  router.get("/v1/jp/holidays", (req, res) => {
    const q = parseQuery(HolidaysQuery, req, res);
    if (!q) return;
    const holidays = holidaysInYear(q.year);
    res.json({ year: q.year, count: holidays.length, holidays, source: HOLIDAY_SOURCE });
  });

  router.get("/v1/jp/business-day", (req, res) => {
    const q = parseQuery(BusinessDayQuery, req, res);
    if (!q) return;
    try {
      res.json(businessDayReport(q.date ?? todayJst(), q.add, q.calendar));
    } catch (err) {
      if (err instanceof CalendarInputError) return badRequest(res, err.message);
      throw err;
    }
  });

  router.get("/v1/jp/bank/resolve", (req, res) => {
    const q = parseQuery(BankResolveQuery, req, res);
    if (!q) return;
    try {
      const bank = resolveBank(q.bank);
      const topBank = bank.candidates[0];
      const branch = q.branch && topBank ? { bankCode: topBank.code, ...resolveBranch(topBank.code, q.branch) } : null;
      const topBranch = branch?.candidates[0];
      const best = topBank
        ? {
            bankCode: topBank.code,
            bankName: topBank.name,
            branchCode: topBranch?.code ?? null,
            branchName: topBranch?.name ?? null,
            confident: bank.confident && (branch === null || branch.confident),
          }
        : null;
      res.json({ bank, branch, best });
    } catch (err) {
      if (err instanceof BankInputError) return badRequest(res, err.message);
      throw err;
    }
  });

  router.get("/v1/jp/bank/lookup", (req, res) => {
    const q = parseQuery(BankLookupQuery, req, res);
    if (!q) return;
    const found = lookupBank(q.bankCode, q.branchCode);
    if (!found) {
      res.status(404).json({ error: "not_found", message: `unknown bank code ${q.bankCode}` });
      return;
    }
    res.json(found);
  });

  router.get("/v1/jp/name/parse", (req, res) => {
    const q = parseQuery(NameParseQuery, req, res);
    if (!q) return;
    try {
      res.json(parseName(q.name, q.kana));
    } catch (err) {
      if (err instanceof NameInputError || err instanceof RomajiInputError) return badRequest(res, err.message);
      throw err;
    }
  });

  router.get("/v1/jp/name/romaji", (req, res) => {
    const q = parseQuery(NameRomajiQuery, req, res);
    if (!q) return;
    try {
      const parts = q.kana.trim().split(/[\s　、，,・]+/).filter((p) => p !== "");
      res.json(parts.length >= 2 ? romanizeName(q.kana) : kanaToRomaji(q.kana));
    } catch (err) {
      if (err instanceof RomajiInputError) return badRequest(res, err.message);
      throw err;
    }
  });

  router.post("/v1/address/normalize", async (req, res, next) => {
    const body = parseBody(AddressBody, req, res);
    if (!body) return;
    try {
      res.json(await normalizeAddress(body.address, body.level));
    } catch (err) {
      if (err instanceof AddressInputError) return badRequest(res, err.message);
      next(err);
    }
  });

  router.post("/v1/text/normalize", (req, res) => {
    const body = parseBody(TextBody, req, res);
    if (!body) return;
    res.json(normalizeText(body.text));
  });

  router.post("/v1/company/resolve", async (req, res, next) => {
    const body = parseBody(CompanyBody, req, res);
    if (!body) return;
    if (!deps.hojin) {
      res.status(503).json({
        error: "upstream_not_configured",
        message: "法人番号 lookup is not enabled on this deployment (HOJIN_APP_ID missing)",
      });
      return;
    }
    try {
      res.json(await resolveCompany(deps.hojin, body.query, { prefectureCode: body.prefectureCode }));
    } catch (err) {
      if (err instanceof CompanyInputError) return badRequest(res, err.message);
      if (err instanceof HojinApiError || err instanceof HojinParseError) {
        res.status(502).json({ error: "upstream_error", message: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
}
