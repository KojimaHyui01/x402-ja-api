import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Access control for /stats. The dashboard exposes who called the service and how, which is not
 * public information, so it is closed by default: without STATS_TOKEN the route serves nothing.
 *
 * Three ways to present the token, so the same URL works in a browser and in a script:
 *   - `Authorization: Bearer <token>`        (curl, scripts)
 *   - `Authorization: Basic <base64 any:<token>>` (browsers, which prompt and then remember)
 *   - `?token=<token>`                       (convenience; ends up in proxy logs, prefer the headers)
 */

export type StatsAuth = "ok" | "unconfigured" | "denied";

/** Compare digests rather than the raw values: constant time, and no length to leak. */
function secretEquals(candidate: string, secret: string): boolean {
  const digest = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(candidate), digest(secret));
}

function fromAuthorizationHeader(header: string): string | undefined {
  const separator = header.indexOf(" ");
  if (separator === -1) return undefined;
  const scheme = header.slice(0, separator).toLowerCase();
  const value = header.slice(separator + 1).trim();
  if (!value) return undefined;
  if (scheme === "bearer") return value;
  if (scheme === "basic") {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    return colon === -1 ? decoded : decoded.slice(colon + 1);
  }
  return undefined;
}

export interface StatsRequest {
  readonly headers: { readonly authorization?: string | undefined };
  readonly query: Readonly<Record<string, unknown>>;
}

/** Extract whatever credential the caller presented, if any. */
export function presentedToken(req: StatsRequest): string | undefined {
  const header = req.headers.authorization;
  if (header) {
    const fromHeader = fromAuthorizationHeader(header);
    if (fromHeader) return fromHeader;
  }
  const query = req.query.token;
  return typeof query === "string" && query !== "" ? query : undefined;
}

export function authorizeStats(req: StatsRequest, secret: string | undefined): StatsAuth {
  if (!secret) return "unconfigured";
  const presented = presentedToken(req);
  if (!presented) return "denied";
  return secretEquals(presented, secret) ? "ok" : "denied";
}
