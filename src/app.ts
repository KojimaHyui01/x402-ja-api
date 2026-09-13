import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { x402HTTPResourceServer, type FacilitatorClient } from "@x402/core/server";
import { paymentMiddlewareFromHTTPServer } from "@x402/express";
import type { Config } from "./config.js";
import { HojinClient } from "./lib/hojin.js";
import { apiRouter } from "./routes/api.js";
import { discoveryRouter } from "./routes/discovery.js";
import { createFreeQuota } from "./x402/free-quota.js";
import { buildResourceServer, buildRoutes } from "./x402/server.js";

export interface AppOptions {
  /** Set false in unit tests to exercise handlers without a facilitator. */
  paywall?: boolean;
  /** Override the facilitator (tests inject a stub). Defaults to testnet x402.org or Coinbase CDP. */
  facilitator?: FacilitatorClient;
  /** Free paid-route calls per client IP per day before the 402 applies (default from config). */
  freeQuotaPerDay?: number;
}

function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[unhandled]", message);
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_error", message: "unexpected server error" });
}

export function createApp(cfg: Config, opts: AppOptions = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(express.json({ limit: "64kb" }));

  // CORS: agents call from anywhere and must be able to read the 402 header.
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, PAYMENT-SIGNATURE, X-PAYMENT, X-Free-Tier");
    res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE");
    next();
  });
  app.options("*splat", (_req, res) => res.sendStatus(204));

  app.use(discoveryRouter(cfg));

  if (opts.paywall !== false) {
    const server = buildResourceServer(cfg, opts.facilitator);
    const quota = createFreeQuota({ perDay: opts.freeQuotaPerDay ?? cfg.FREE_QUOTA_PER_DAY });
    const httpServer = new x402HTTPResourceServer(server, buildRoutes(cfg)).onProtectedRequest(quota.hook);
    app.use(paymentMiddlewareFromHTTPServer(httpServer));
  }

  const hojin = cfg.HOJIN_APP_ID ? new HojinClient(cfg.HOJIN_APP_ID) : null;
  app.use(apiRouter({ hojin }));

  app.use((_req, res) => res.status(404).json({ error: "not_found" }));
  app.use(errorHandler);
  return app;
}
