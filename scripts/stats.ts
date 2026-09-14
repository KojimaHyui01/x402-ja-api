/**
 * Read the operator dashboard from the shell. /stats needs STATS_TOKEN, and passing a secret
 * through an npm script portably (sh vs cmd vs PowerShell) is more trouble than a 20-line script.
 *
 * Usage:
 *   STATS_TOKEN=... npm run stats -- [baseUrl]
 */
import "dotenv/config";

const baseUrl = (process.argv[2] ?? process.env.PUBLIC_BASE_URL ?? "https://x402-ja-api.onrender.com").replace(/\/$/, "");

async function main(): Promise<void> {
  const token = process.env.STATS_TOKEN;
  if (!token) {
    console.error("STATS_TOKEN is required (the same value set on the server).");
    process.exit(1);
  }
  const res = await fetch(`${baseUrl}/stats?format=json`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.text();
  if (!res.ok) {
    console.error(`${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(JSON.stringify(JSON.parse(body), null, 2));
}

main().catch((err) => {
  console.error("stats failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
