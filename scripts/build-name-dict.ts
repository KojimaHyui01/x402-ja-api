/**
 * Build data/names/dict.json — a compact personal-name dictionary so the server needs no
 * morphological analyser (kuromoji costs ~300 MB RSS; this JSON costs ~10 MB).
 *
 * Sources
 *  - mecab-ipadic Noun.name.csv (NAIST license, EUC-JP): 姓/名 entries with readings and cost (lower = more frequent)
 *  - data/names/surnames.csv + given-names.csv (MIT, japanese-personal-name-dataset)
 *
 * Usage: npx tsx scripts/build-name-dict.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const IPADIC_URL = "https://raw.githubusercontent.com/taku910/mecab/master/mecab-ipadic/Noun.name.csv";
const IPADIC_LICENSE_URL = "https://raw.githubusercontent.com/taku910/mecab/master/mecab-ipadic/COPYING";
const DIR = new URL("../data/names/", import.meta.url);

type ReadingMap = Record<string, [kana: string, weight: number][]>;
/** kanji → kana → { source → weight } */
type Collected = Map<string, Map<string, Map<string, number>>>;

const kata2hira = (s: string): string => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

function add(col: Collected, kanji: string, kana: string, source: string, weight: number): void {
  const byKana = col.get(kanji) ?? new Map<string, Map<string, number>>();
  const bySource = byKana.get(kana) ?? new Map<string, number>();
  bySource.set(source, Math.max(bySource.get(source) ?? 0, weight));
  byKana.set(kana, bySource);
  col.set(kanji, byKana);
}

/** Readings confirmed by two independent sources get a bonus. */
function finalize(col: Collected): ReadingMap {
  const out: ReadingMap = {};
  for (const [kanji, byKana] of col) {
    const list: [string, number][] = [];
    for (const [kana, bySource] of byKana) {
      const max = Math.max(...bySource.values());
      const w = bySource.size > 1 ? Math.min(0.97, max + 0.08) : max;
      list.push([kana, Math.round(w * 1000) / 1000]);
    }
    list.sort((a, b) => b[1] - a[1]);
    out[kanji] = list;
  }
  return out;
}

async function fetchText(url: string, encoding: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "x402-ja-api build" } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new TextDecoder(encoding).decode(await res.arrayBuffer());
}

async function main(): Promise<void> {
  const surnames: Collected = new Map();
  const given: Collected = new Map();

  // IPADIC: surface,left,right,cost,pos,pos1,pos2,pos3,ctype,cform,base,reading,pron
  const ipadic = await fetchText(IPADIC_URL, "euc-jp");
  let costMin = Infinity;
  let costMax = -Infinity;
  const rows: [string, string, string, number][] = [];
  for (const line of ipadic.split(/\r?\n/)) {
    const f = line.split(",");
    if (f.length < 13) continue;
    const kind = f[7]!;
    if (kind !== "姓" && kind !== "名") continue;
    const cost = Number(f[3]);
    costMin = Math.min(costMin, cost);
    costMax = Math.max(costMax, cost);
    rows.push([f[0]!, kind, kata2hira(f[11]!), cost]);
  }
  // weight 0..1: frequent (low cost) → high
  for (const [surface, kind, kana, cost] of rows) {
    const w = Math.round((1 - (cost - costMin) / (costMax - costMin)) * 1000) / 1000;
    add(kind === "姓" ? surnames : given, surface, kana, "ipadic", 0.5 + w * 0.4); // 0.5..0.9
  }

  // dataset surnames: kanji,population,hiragana,romaji
  for (const line of readFileSync(new URL("surnames.csv", DIR), "utf8").split(/\r?\n/)) {
    const [kanji, , kana] = line.split(",");
    if (kanji && kana) add(surnames, kanji, kana, "dataset", 0.9);
  }
  // dataset given: hiragana,romaji,kanji...
  for (const line of readFileSync(new URL("given-names.csv", DIR), "utf8").split(/\r?\n/)) {
    const [kana, , ...kanjis] = line.split(",");
    if (!kana) continue;
    for (const k of kanjis) if (k) add(given, k, kana, "dataset", 0.78);
  }
  const surnameMap = finalize(surnames);
  const givenMap = finalize(given);

  const out = {
    builtAt: new Date().toISOString(),
    sources: [
      "mecab-ipadic Noun.name.csv (NAIST license — see IPADIC-COPYING.txt)",
      "japanese-personal-name-dataset (MIT — see LICENSE.txt)",
    ],
    counts: { surnames: Object.keys(surnameMap).length, given: Object.keys(givenMap).length },
    surnames: surnameMap,
    given: givenMap,
  };
  writeFileSync(new URL("dict.json", DIR), JSON.stringify(out));
  writeFileSync(new URL("IPADIC-COPYING.txt", DIR), await fetchText(IPADIC_LICENSE_URL, "utf-8"));
  console.log(`wrote ${fileURLToPath(new URL("dict.json", DIR))}: ${out.counts.surnames} surnames, ${out.counts.given} given names`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
