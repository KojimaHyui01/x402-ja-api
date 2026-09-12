import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AddressInputError, normalizeAddress } from "../lib/address.js";
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

interface ApiDeps {
  hojin: HojinClient | null;
}

function badRequest(res: Response, message: string, details?: unknown): void {
  res.status(400).json({ error: "bad_request", message, details });
}

function parseBody<T>(schema: z.ZodSchema<T>, req: Request, res: Response): T | null {
  const parsed = schema.safeParse(req.body);
  if (parsed.success) return parsed.data;
  badRequest(res, "invalid request body", parsed.error.flatten());
  return null;
}

/** Paid endpoints. Payment enforcement happens in middleware mounted before this router. */
export function apiRouter(deps: ApiDeps): Router {
  const router = Router();

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
