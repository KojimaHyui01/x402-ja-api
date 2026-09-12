/**
 * Kana → Hepburn romaji, with the 外務省 passport conventions as the primary output:
 *  - long vowels オウ/オオ/ウウ are dropped (佐藤 SATO, 大野 ONO, 裕子 YUKO); a trailing オオ keeps OO (横尾 YOKOO)
 *  - イイ and エイ are written out (飯田 IIDA, 英子 EIKO)
 *  - ン before B/M/P becomes M (難波 NAMBA, 本間 HOMMA)
 *  - っ doubles the next consonant; before CH it becomes T (服部 HATTORI, 八馳 HATCHI)
 *  - no apostrophes (順一 JUNICHI)
 * Alternatives returned alongside: OH-style (SATOH, allowed as 非ヘボン式), macron Hepburn (Satō), strict letter-by-letter.
 */

export interface RomajiForms {
  input: string;
  kana: string;
  /** 外務省 passport form, uppercase */
  passport: string;
  /** passport form capitalised (Sato) */
  capitalized: string;
  /** long O written as OH (SATOH, OHNO) — accepted as 非ヘボン式 on passports */
  ohStyle: string;
  /** academic Hepburn with macrons (Satō) */
  macron: string;
  /** strict letter-by-letter Hepburn, lowercase (satou, oono, jun'ichi) */
  hepburn: string;
}

export interface RomanizedName {
  input: string;
  family: RomajiForms;
  given: RomajiForms;
  /** "SATO YUKO" (passport order: family first) */
  passport: string;
  /** "Yuko Sato" */
  western: string;
  /** "Sato Yuko" */
  eastern: string;
}

export class RomajiInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RomajiInputError";
  }
}

const MORA: Readonly<Record<string, string>> = {
  ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o",
  カ: "ka", キ: "ki", ク: "ku", ケ: "ke", コ: "ko",
  サ: "sa", シ: "shi", ス: "su", セ: "se", ソ: "so",
  タ: "ta", チ: "chi", ツ: "tsu", テ: "te", ト: "to",
  ナ: "na", ニ: "ni", ヌ: "nu", ネ: "ne", ノ: "no",
  ハ: "ha", ヒ: "hi", フ: "fu", ヘ: "he", ホ: "ho",
  マ: "ma", ミ: "mi", ム: "mu", メ: "me", モ: "mo",
  ヤ: "ya", ユ: "yu", ヨ: "yo",
  ラ: "ra", リ: "ri", ル: "ru", レ: "re", ロ: "ro",
  ワ: "wa", ヰ: "i", ヱ: "e", ヲ: "o",
  ガ: "ga", ギ: "gi", グ: "gu", ゲ: "ge", ゴ: "go",
  ザ: "za", ジ: "ji", ズ: "zu", ゼ: "ze", ゾ: "zo",
  ダ: "da", ヂ: "ji", ヅ: "zu", デ: "de", ド: "do",
  バ: "ba", ビ: "bi", ブ: "bu", ベ: "be", ボ: "bo",
  パ: "pa", ピ: "pi", プ: "pu", ペ: "pe", ポ: "po",
  ヴ: "vu",
  ァ: "a", ィ: "i", ゥ: "u", ェ: "e", ォ: "o", ヮ: "wa", ヵ: "ka", ヶ: "ke",
  キャ: "kya", キュ: "kyu", キョ: "kyo",
  シャ: "sha", シュ: "shu", ショ: "sho", シェ: "she",
  チャ: "cha", チュ: "chu", チョ: "cho", チェ: "che",
  ニャ: "nya", ニュ: "nyu", ニョ: "nyo",
  ヒャ: "hya", ヒュ: "hyu", ヒョ: "hyo",
  ミャ: "mya", ミュ: "myu", ミョ: "myo",
  リャ: "rya", リュ: "ryu", リョ: "ryo",
  ギャ: "gya", ギュ: "gyu", ギョ: "gyo",
  ジャ: "ja", ジュ: "ju", ジョ: "jo", ジェ: "je",
  ヂャ: "ja", ヂュ: "ju", ヂョ: "jo",
  ビャ: "bya", ビュ: "byu", ビョ: "byo",
  ピャ: "pya", ピュ: "pyu", ピョ: "pyo",
  ティ: "ti", ディ: "di", デュ: "dyu", トゥ: "tu", ドゥ: "du",
  ファ: "fa", フィ: "fi", フェ: "fe", フォ: "fo", フュ: "fyu",
  ウィ: "wi", ウェ: "we", ウォ: "wo",
  ヴァ: "va", ヴィ: "vi", ヴェ: "ve", ヴォ: "vo",
  ツァ: "tsa", ツィ: "tsi", ツェ: "tse", ツォ: "tso", イェ: "ye",
};

type Unit = { kind: "mora"; r: string } | { kind: "sokuon" } | { kind: "n" } | { kind: "chouon" };

const VOWELS = new Set(["a", "i", "u", "e", "o"]);
const MACRON: Readonly<Record<string, string>> = { a: "ā", i: "ī", u: "ū", e: "ē", o: "ō" };

/** Any-width kana / hiragana → full-width katakana. */
export function toKatakana(input: string): string {
  return input.normalize("NFKC").replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

function tokenize(kata: string): Unit[] {
  const units: Unit[] = [];
  for (let i = 0; i < kata.length; i += 1) {
    const two = kata.slice(i, i + 2);
    const one = kata[i]!;
    if (MORA[two] !== undefined && two.length === 2) {
      units.push({ kind: "mora", r: MORA[two]! });
      i += 1;
    } else if (one === "ッ") {
      units.push({ kind: "sokuon" });
    } else if (one === "ン") {
      units.push({ kind: "n" });
    } else if (one === "ー") {
      units.push({ kind: "chouon" });
    } else if (MORA[one] !== undefined) {
      units.push({ kind: "mora", r: MORA[one]! });
    } else {
      throw new RomajiInputError(`unsupported character "${one}" — input must be hiragana or katakana`);
    }
  }
  return units;
}

type Style = "passport" | "oh" | "macron" | "strict";

interface Syl {
  text: string;
  /** vowel this syllable ends with, if any */
  vowel: string | null;
}

/**
 * Render units in the requested style. Long vowels are decided per passport rules and then
 * expressed differently per style (dropped / OH / macron / written out).
 */
function render(units: Unit[], style: Style): string {
  const out: Syl[] = [];
  const lastIndex = units.length - 1;

  for (let i = 0; i <= lastIndex; i += 1) {
    const u = units[i]!;
    const prev = out[out.length - 1];
    const next = units[i + 1];
    const nextR = next?.kind === "mora" ? next.r : next?.kind === "n" ? "n" : "";

    if (u.kind === "sokuon") {
      if (nextR === "") continue;
      const consonant = nextR.startsWith("ch") ? "t" : nextR[0]!;
      out.push({ text: VOWELS.has(consonant) ? "" : consonant, vowel: null });
      continue;
    }
    if (u.kind === "n") {
      const labial = /^[bmp]/.test(nextR);
      const needsSeparator = /^[aiueoy]/.test(nextR);
      const text = style === "passport" || style === "oh" ? (labial ? "m" : "n") : needsSeparator ? "n'" : "n";
      out.push({ text, vowel: null });
      continue;
    }
    if (u.kind === "chouon") {
      if (!prev?.vowel) continue;
      applyLong(out, prev.vowel, style, false, true);
      continue;
    }

    // mora
    const r = u.r;
    const vowel = r[r.length - 1]!;
    const isPureVowel = r.length === 1 && VOWELS.has(r);
    if (isPureVowel && prev?.vowel) {
      const pair = prev.vowel + r;
      const isLong = pair === "ou" || pair === "oo" || pair === "uu";
      if (isLong) {
        applyLong(out, prev.vowel, style, i === lastIndex && pair === "oo", false);
        continue;
      }
    }
    out.push({ text: r, vowel });
  }
  return out.map((s) => s.text).join("");
}

/**
 * Express a long vowel that the passport rule would drop.
 * `trailingOo` = the word ends in オオ (横尾 → YOKOO), the one case passports keep.
 */
function applyLong(out: Syl[], vowel: string, style: Style, trailingOo: boolean, fromChouon: boolean): void {
  const prev = out[out.length - 1]!;
  switch (style) {
    case "passport":
      if (trailingOo) out.push({ text: "o", vowel: "o" });
      return;
    case "oh":
      if (trailingOo) out.push({ text: "o", vowel: "o" });
      else if (vowel === "o") out.push({ text: "h", vowel: null });
      return;
    case "macron":
      prev.text = prev.text.slice(0, -1) + (MACRON[vowel] ?? vowel);
      return;
    case "strict":
      out.push({ text: vowel, vowel });
      return;
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Romanize one kana token (a family or given name). */
export function kanaToRomaji(input: string): RomajiForms {
  const kana = toKatakana(input).replace(/[\s　]/g, "");
  if (kana.length === 0) throw new RomajiInputError("kana must not be empty");
  if (kana.length > 50) throw new RomajiInputError("kana must be at most 50 characters");
  const units = tokenize(kana);
  const passportLower = render(units, "passport");
  // strict: オウ inside a word is written "ou"; a trailing オオ → "oo"; ー → repeated vowel
  const strictUnits = units.map((u) => u);
  return {
    input,
    kana,
    passport: passportLower.toUpperCase(),
    capitalized: capitalize(passportLower),
    ohStyle: render(units, "oh").toUpperCase(),
    macron: capitalize(render(units, "macron")),
    hepburn: renderStrict(strictUnits),
  };
}

function renderStrict(units: Unit[]): string {
  const out: string[] = [];
  let prevVowel: string | null = null;
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i]!;
    const next = units[i + 1];
    const nextR = next?.kind === "mora" ? next.r : "";
    if (u.kind === "sokuon") {
      if (nextR) out.push(nextR.startsWith("ch") ? "t" : nextR[0]!);
      prevVowel = null;
    } else if (u.kind === "n") {
      out.push(/^[aiueoy]/.test(nextR) ? "n'" : "n");
      prevVowel = null;
    } else if (u.kind === "chouon") {
      if (prevVowel) out.push(prevVowel);
    } else {
      out.push(u.r);
      prevVowel = u.r[u.r.length - 1]!;
    }
  }
  return out.join("");
}

const NAME_SEPARATOR = /[\s　、，,・]+/;

/** "さとう ゆうこ" → family + given forms and combined orders. */
export function romanizeName(input: string): RomanizedName {
  const parts = input.trim().split(NAME_SEPARATOR).filter((p) => p !== "");
  if (parts.length !== 2) {
    throw new RomajiInputError('name must be "<family kana> <given kana>" separated by a space');
  }
  const family = kanaToRomaji(parts[0]!);
  const given = kanaToRomaji(parts[1]!);
  return {
    input,
    family,
    given,
    passport: `${family.passport} ${given.passport}`,
    western: `${given.capitalized} ${family.capitalized}`,
    eastern: `${family.capitalized} ${given.capitalized}`,
  };
}
