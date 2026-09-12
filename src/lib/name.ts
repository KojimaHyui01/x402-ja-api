import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { RomajiInputError, kanaToRomaji, toKatakana } from "./romaji.js";

/**
 * Japanese personal-name parsing: family/given split + reading candidates + passport romaji.
 *
 * Runs on a compact dictionary (data/names/dict.json, built by scripts/build-name-dict.ts from
 * mecab-ipadic 人名 entries + japanese-personal-name-dataset) — no morphological analyser needed.
 * Given-name readings are inherently ambiguous (幸規 = こうき / ゆきのり), so they are always returned
 * as ranked *candidates* with a confidence label; callers that have the kana should pass it.
 */

export type Confidence = "high" | "medium" | "low";
export type ReadingSource = "provided" | "dictionary";

export interface Reading {
  kana: string;
  score: number;
  source: ReadingSource;
}

export interface NamePart {
  kanji: string;
  readings: readonly Reading[];
  confidence: Confidence;
}

export interface ParsedName {
  input: string;
  family: NamePart;
  given: NamePart;
  split: { method: "separator" | "dictionary" | "fallback"; confidence: number };
  romaji: {
    basis: "provided-kana" | "best-guess";
    passport: string;
    western: string;
    family: string;
    given: string;
  } | null;
  notes: readonly string[];
}

export const MAX_NAME_LENGTH = 40;

export class NameInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NameInputError";
  }
}

type ReadingMap = Record<string, [kana: string, weight: number][]>;

interface Dict {
  builtAt: string;
  counts: { surnames: number; given: number };
  surnames: ReadingMap;
  given: ReadingMap;
}

const DICT_PATH = process.env.NAME_DICT_PATH ?? fileURLToPath(new URL("../../data/names/dict.json", import.meta.url));
const DICT: Dict = JSON.parse(readFileSync(DICT_PATH, "utf8")) as Dict;
const MAX_SURNAME_LENGTH = Math.max(...Object.keys(DICT.surnames).map((k) => k.length));

export const NAME_DICT_INFO = Object.freeze({ ...DICT.counts, builtAt: DICT.builtAt });

/** Kept for API compatibility with the async-init era; the dictionary loads synchronously. */
export function initNameParser(): Promise<void> {
  return Promise.resolve();
}

export function isNameParserReady(): boolean {
  return true;
}

const kata2hira = (s: string): string => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const SEPARATOR = /[\s　、，,・]+/;
const MAX_READINGS = 8;

function topWeight(map: ReadingMap, kanji: string): number {
  return map[kanji]?.[0]?.[1] ?? 0;
}

interface Split {
  family: string;
  given: string;
  method: ParsedName["split"]["method"];
  confidence: number;
}

/**
 * Choose the family/given boundary. Every prefix that is a known surname is a candidate;
 * a candidate whose remainder is a known given name wins, then the more frequent surname,
 * then the longer one (東海林 over 東).
 */
function splitByDictionary(full: string): Split {
  type Cand = { len: number; score: number; givenKnown: boolean };
  const cands: Cand[] = [];
  for (let len = 1; len <= Math.min(MAX_SURNAME_LENGTH, full.length - 1); len += 1) {
    const fam = full.slice(0, len);
    const famW = topWeight(DICT.surnames, fam);
    if (famW === 0) continue;
    const giv = full.slice(len);
    const givW = topWeight(DICT.given, giv);
    cands.push({ len, givenKnown: givW > 0, score: (givW > 0 ? 2 : 0) + famW + len * 0.05 });
  }
  if (cands.length > 0) {
    const best = cands.sort((a, b) => b.score - a.score)[0]!;
    return {
      family: full.slice(0, best.len),
      given: full.slice(best.len),
      method: "dictionary",
      confidence: best.givenKnown ? 0.95 : 0.85,
    };
  }
  if (DICT.surnames[full]) return { family: full, given: "", method: "dictionary", confidence: 0.6 };
  if (DICT.given[full]) return { family: "", given: full, method: "dictionary", confidence: 0.6 };
  // unknown everywhere: assume the common 2-char surname
  const len = full.length >= 3 ? 2 : 1;
  return { family: full.slice(0, len), given: full.slice(len), method: "fallback", confidence: 0.4 };
}

function readingsFor(map: ReadingMap, kanji: string): Reading[] {
  if (kanji === "") return [];
  return (map[kanji] ?? []).slice(0, MAX_READINGS).map(([kana, w]) => ({ kana, score: w, source: "dictionary" as const }));
}

function label(top: number | undefined): Confidence {
  if (top === undefined) return "low";
  if (top >= 0.9) return "high";
  if (top >= 0.7) return "medium";
  return "low";
}

function providedReading(kana: string): Reading[] {
  return [{ kana: kata2hira(toKatakana(kana)), score: 1, source: "provided" }];
}

/**
 * Parse a Japanese full name. `kana` (optional) = "<family kana> <given kana>" when known;
 * it overrides the guessed readings and makes the romaji deterministic.
 */
export function parseName(name: string, kana?: string): ParsedName {
  const input = name.normalize("NFKC").trim();
  if (input.length === 0) throw new NameInputError("name must not be empty");
  if (input.length > MAX_NAME_LENGTH) throw new NameInputError(`name must be at most ${MAX_NAME_LENGTH} characters`);

  const notes: string[] = [];
  const parts = input.split(SEPARATOR).filter((p) => p !== "");
  const split: Split =
    parts.length >= 2
      ? { family: parts[0]!, given: parts.slice(1).join(""), method: "separator", confidence: 1 }
      : splitByDictionary(parts[0] ?? input);
  if (split.given === "" || split.family === "") notes.push("input looks like a single name");
  if (split.method === "fallback") notes.push("neither part is in the name dictionary; split is a guess");

  let familyR = readingsFor(DICT.surnames, split.family);
  let givenR = readingsFor(DICT.given, split.given);

  let provided = false;
  if (kana !== undefined && kana.trim() !== "") {
    const kp = kana.normalize("NFKC").trim().split(SEPARATOR).filter((p) => p !== "");
    if (kp.length !== 2) throw new NameInputError('kana must be "<family kana> <given kana>" separated by a space');
    familyR = providedReading(kp[0]!);
    givenR = providedReading(kp[1]!);
    provided = true;
  } else {
    if (givenR.length > 1) notes.push("given-name reading is ambiguous; candidates are ordered by likelihood — pass `kana` when known");
    if (split.given !== "" && givenR.length === 0) notes.push("no reading found for the given name; pass `kana`");
    if (split.family !== "" && familyR.length === 0) notes.push("no reading found for the family name; pass `kana`");
  }

  const bestFamily = familyR[0]?.kana;
  const bestGiven = givenR[0]?.kana;
  let romaji: ParsedName["romaji"] = null;
  if (bestFamily && bestGiven) {
    try {
      const f = kanaToRomaji(bestFamily);
      const g = kanaToRomaji(bestGiven);
      romaji = {
        basis: provided ? "provided-kana" : "best-guess",
        passport: `${f.passport} ${g.passport}`,
        western: `${g.capitalized} ${f.capitalized}`,
        family: f.passport,
        given: g.passport,
      };
    } catch (err) {
      if (!(err instanceof RomajiInputError)) throw err;
      notes.push(`could not romanize: ${err.message}`);
    }
  }

  return {
    input,
    family: { kanji: split.family, readings: familyR, confidence: label(familyR[0]?.score) },
    given: { kanji: split.given, readings: givenR, confidence: label(givenR[0]?.score) },
    split: { method: split.method, confidence: split.confidence },
    romaji,
    notes,
  };
}
