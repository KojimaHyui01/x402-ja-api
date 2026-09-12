/**
 * Refresh data/holidays.json from the Cabinet Office's official CSV (Shift_JIS).
 * Source: https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html  (政府標準利用規約 v2.0)
 * The CSV is updated roughly once a year (next year's holidays appear around February).
 *
 * Usage: npx tsx scripts/update-holidays.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
const OUT = fileURLToPath(new URL("../data/holidays.json", import.meta.url));

function toIso(jpDate: string): string {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(jpDate.trim());
  if (!m) throw new Error(`unexpected date format: ${jpDate}`);
  return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": "x402-ja-api/0.1 (+https://x402-ja-api.onrender.com)" } });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const text = new TextDecoder("shift_jis").decode(await res.arrayBuffer());
  const rows = text.split(/\r?\n/).slice(1).filter((l) => l.trim() !== "");
  const holidays: Record<string, string> = {};
  for (const row of rows) {
    const [date, name] = row.split(",");
    if (!date || !name) throw new Error(`malformed row: ${row}`);
    holidays[toIso(date)] = name.trim();
  }
  const dates = Object.keys(holidays).sort();
  const out = {
    source: SOURCE_URL,
    license: "内閣府ホームページ 政府標準利用規約（第2.0版）",
    fetchedAt: new Date().toISOString(),
    from: dates[0],
    to: dates[dates.length - 1],
    count: dates.length,
    holidays: Object.fromEntries(dates.map((d) => [d, holidays[d]])),
  };
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${OUT}: ${out.count} holidays, ${out.from} .. ${out.to}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
