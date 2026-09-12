import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AddressInputError, normalizeAddress } from "../lib/address.js";
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
import { normalizeText } from "../lib/text.js";

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
