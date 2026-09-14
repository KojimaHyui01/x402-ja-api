import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { findEndpointByPath } from "../x402/catalog.js";
import { logEvent } from "./log.js";

/**
 * Who is actually calling the service, and are they a crawler?
 *
 * The per-route counters in x402/metrics.ts answer "what was called"; they cannot tell one client
 * sweeping every endpoint apart from a dozen people each trying one. This aggregates by client and
 * guesses intent, so /stats can separate registry crawlers from someone evaluating the API.
 *
 * Clients are identified by a salted hash of their IP, never the address itself. In-process and
 * reset on deploy, like the rest of sinceBoot; the stdout log is the copy that outlives a restart.
 */

export type VisitorClass = "paying" | "docs-reader" | "crawler" | "browser" | "tool" | "unknown";

export type Outcome = "paid" | "free" | "challenged" | "other";

export interface VisitorRecord {
  readonly id: string;
  readonly class: VisitorClass;
  readonly ua: string;
  readonly requests: number;
  readonly routes: readonly string[];
  readonly paid: number;
  readonly free: number;
  readonly challenged: number;
  readonly other: number;
  readonly first: string;
  readonly last: string;
}

export interface VisitorSnapshot {
  readonly unique: number;
  readonly byClass: Readonly<Record<VisitorClass, number>>;
  readonly clients: readonly VisitorRecord[];
}

/** Explicit self-identification as automation. */
const CRAWLER_UA = /bot\b|crawler|spider|scraper|slurp|monitor|uptime|pingdom|scan(ner)?\b|x402scan|headless/i;
/** Generic HTTP clients: a person scripting, or automation that did not announce itself. */
const TOOL_UA = /curl|wget|python-requests|httpx|aiohttp|go-http-client|okhttp|java\/|axios|node-fetch|undici|postman|insomnia/i;

/** Touching this many distinct endpoints looks like enumeration rather than use. */
const SWEEP_ROUTES = 6;
const MAX_CLIENTS = 5_000;
const MAX_ROUTES_PER_CLIENT = 40;
const UA_MAX_LENGTH = 160;
/** Render health checks and the operator's own dashboard are not visitors. */
const IGNORED_PATHS = new Set(["/health", "/stats", "/favicon.ico"]);

interface ClientState {
  readonly id: string;
  ua: string;
  requests: number;
  readonly routes: Set<string>;
  paid: number;
  free: number;
  challenged: number;
  other: number;
  readonly first: string;
  last: string;
  /** Sticky: one paid call or one documented-header call classifies the client for good. */
  sawPayment: boolean;
  sawFreeTierHeader: boolean;
}

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (first) return first.split(",")[0]!.trim();
  return req.ip ?? "unknown";
}

function routeLabel(req: Request): string {
  const endpoint = findEndpointByPath(req.path);
  return endpoint ? endpoint.key : `${req.method.toUpperCase()} ${req.path}`;
}

function outcomeOf(req: Request, status: number): Outcome {
  const paying = Boolean(req.headers["payment-signature"] ?? req.headers["x-payment"]);
  if (paying && status < 400) return "paid";
  if (status === 402) return "challenged";
  if (req.headers["x-free-tier"] && status < 400) return "free";
  return "other";
}

/**
 * Order matters: paying and reading the docs are positive evidence of a real user and outrank a
 * suspicious user agent, while a sweep across many endpoints outranks whatever the UA claims.
 */
function classify(state: ClientState): VisitorClass {
  if (state.sawPayment) return "paying";
  if (state.sawFreeTierHeader) return "docs-reader";
  if (!state.ua || CRAWLER_UA.test(state.ua)) return "crawler";
  if (state.routes.size >= SWEEP_ROUTES) return "crawler";
  if (TOOL_UA.test(state.ua)) return "tool";
  if (state.ua.startsWith("Mozilla/")) return "browser";
  return "unknown";
}

function emptyByClass(): Record<VisitorClass, number> {
  return { paying: 0, "docs-reader": 0, crawler: 0, browser: 0, tool: 0, unknown: 0 };
}

export class Visitors {
  private readonly salt: string;
  private readonly clients = new Map<string, ClientState>();

  /** A fixed salt keeps ids comparable across deploys; the default rotates them every boot. */
  constructor(salt?: string) {
    this.salt = salt ?? randomBytes(16).toString("hex");
  }

  private identify(ip: string): string {
    return createHash("sha256").update(`${this.salt}:${ip}`, "utf8").digest("hex").slice(0, 12);
  }

  middleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (IGNORED_PATHS.has(req.path)) {
        next();
        return;
      }
      res.on("finish", () => this.record(req, res.statusCode));
      next();
    };
  }

  private record(req: Request, status: number): void {
    const id = this.identify(clientIp(req));
    const at = new Date().toISOString();
    const ua = String(req.headers["user-agent"] ?? "").slice(0, UA_MAX_LENGTH);
    const route = routeLabel(req);
    const outcome = outcomeOf(req, status);

    const state = this.state(id, at);
    state.requests += 1;
    state.last = at;
    if (ua) state.ua = ua;
    if (state.routes.size < MAX_ROUTES_PER_CLIENT) state.routes.add(route);
    state[outcome] += 1;
    if (outcome === "paid") state.sawPayment = true;
    if (req.headers["x-free-tier"]) state.sawFreeTierHeader = true;

    logEvent({ at, client: id, class: classify(state), route, status, outcome, ua });
  }

  private state(id: string, at: string): ClientState {
    const existing = this.clients.get(id);
    if (existing) return existing;
    if (this.clients.size >= MAX_CLIENTS) this.clients.clear();
    const fresh: ClientState = {
      id,
      ua: "",
      requests: 0,
      routes: new Set<string>(),
      paid: 0,
      free: 0,
      challenged: 0,
      other: 0,
      first: at,
      last: at,
      sawPayment: false,
      sawFreeTierHeader: false,
    };
    this.clients.set(id, fresh);
    return fresh;
  }

  snapshot(): VisitorSnapshot {
    const byClass = emptyByClass();
    const clients = [...this.clients.values()]
      .map((c): VisitorRecord => {
        const klass = classify(c);
        byClass[klass] += 1;
        return {
          id: c.id,
          class: klass,
          ua: c.ua,
          requests: c.requests,
          routes: [...c.routes].sort(),
          paid: c.paid,
          free: c.free,
          challenged: c.challenged,
          other: c.other,
          first: c.first,
          last: c.last,
        };
      })
      .sort((a, b) => b.last.localeCompare(a.last));
    return { unique: clients.length, byClass, clients };
  }

  /** test hook */
  reset(): void {
    this.clients.clear();
  }
}
