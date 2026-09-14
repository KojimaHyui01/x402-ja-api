/**
 * One structured JSON line per event on stdout. Render collects service output into its log
 * explorer (7 days on Starter), which is the only copy of this data that survives a restart —
 * everything the dashboard shows is in-process and resets on deploy.
 *
 * Deliberately dependency-free: the service emits roughly one line per request, which does not
 * justify pulling in a logging framework. Swap the body for pino if that changes.
 */
export function logEvent(event: Readonly<Record<string, unknown>>): void {
  // Test runs make thousands of requests; their output is noise, not a log.
  if (process.env.NODE_ENV === "test") return;
  process.stdout.write(`${JSON.stringify(event)}
`);
}
