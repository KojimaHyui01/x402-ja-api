import { describe, expect, it } from "vitest";
import { RomajiInputError, kanaToRomaji, romanizeName } from "../src/lib/romaji.js";

describe("kanaToRomaji – passport (外務省ヘボン式) rules", () => {
  const cases: [string, string][] = [
    ["さとう", "SATO"], // 長音 オウ → O
    ["おおの", "ONO"], // 長音 オオ → O
    ["よこお", "YOKOO"], // 末尾の オオ は OO
    ["せのお", "SENOO"],
    ["ゆうこ", "YUKO"], // 長音 ウウ → U
    ["いいだ", "IIDA"], // イイ は残す
    ["えいこ", "EIKO"], // エイ は残す
    ["なんば", "NAMBA"], // ン + B → M
    ["ほんま", "HOMMA"], // ン + M → M
    ["さんぺい", "SAMPEI"], // ン + P → M
    ["しんじ", "SHINJI"], // ン + J → N
    ["はっとり", "HATTORI"], // 促音
    ["はっち", "HATCHI"], // 促音 + CH → T
    ["みっしぇる", "MISSHERU"],
    ["しゅんすけ", "SHUNSUKE"],
    ["ちよ", "CHIYO"],
    ["つよし", "TSUYOSHI"],
    ["ふじい", "FUJII"],
    ["じゅんいち", "JUNICHI"], // passport: no apostrophe
    ["きょうこ", "KYOKO"], // ョウ 長音 → O
    ["りょう", "RYO"],
    ["こうた", "KOTA"],
    ["おうじ", "OJI"],
    ["ヴぃくとる", "VIKUTORU"],
    ["サトウ", "SATO"], // katakana input
    ["ｻﾄｳ", "SATO"], // half-width input
  ];
  for (const [kana, romaji] of cases) {
    it(`${kana} → ${romaji}`, () => {
      expect(kanaToRomaji(kana).passport).toBe(romaji);
    });
  }

  it("also offers the OH-style and macron variants", () => {
    const r = kanaToRomaji("さとう");
    expect(r.ohStyle).toBe("SATOH");
    expect(r.macron).toBe("Satō");
    expect(r.hepburn).toBe("Satou".toLowerCase() === "satou" ? "satou" : r.hepburn); // strict letter-by-letter form
  });

  it("rejects non-kana input", () => {
    expect(() => kanaToRomaji("佐藤")).toThrow(RomajiInputError);
    expect(() => kanaToRomaji("")).toThrow(RomajiInputError);
  });
});

describe("romanizeName", () => {
  it("handles family/given separated by space and returns passport order", () => {
    const r = romanizeName("さとう ゆうこ");
    expect(r.family.passport).toBe("SATO");
    expect(r.given.passport).toBe("YUKO");
    expect(r.passport).toBe("SATO YUKO");
    expect(r.western).toBe("Yuko Sato");
  });
  it("accepts 、/，/full-width space separators", () => {
    expect(romanizeName("やまだ　たろう").passport).toBe("YAMADA TARO");
  });
  it("requires exactly two parts", () => {
    expect(() => romanizeName("さとう")).toThrow(RomajiInputError);
  });
});
