import { beforeAll, describe, expect, it } from "vitest";
import { NameInputError, initNameParser, parseName } from "../src/lib/name.js";

beforeAll(async () => {
  await initNameParser();
}, 60_000);

describe("parseName – splitting", () => {
  it("splits common names via the dictionary", () => {
    for (const [full, family, given] of [
      ["山田太郎", "山田", "太郎"],
      ["佐藤裕子", "佐藤", "裕子"],
      ["菅義偉", "菅", "義偉"],
      ["小嶋彪允", "小嶋", "彪允"],
      ["長谷川博己", "長谷川", "博己"],
    ] as const) {
      const r = parseName(full);
      expect(r.family.kanji, full).toBe(family);
      expect(r.given.kanji, full).toBe(given);
      expect(r.split.confidence, full).toBeGreaterThanOrEqual(0.85);
    }
  });
  it("respects an explicit separator", () => {
    const r = parseName("小 太郎");
    expect(r.family.kanji).toBe("小");
    expect(r.given.kanji).toBe("太郎");
    expect(r.split.method).toBe("separator");
    expect(r.split.confidence).toBe(1);
  });
  it("recognises a lone given name / lone surname and lowers confidence", () => {
    const g = parseName("太郎");
    expect(g.family.kanji).toBe("");
    expect(g.given.kanji).toBe("太郎");
    expect(g.split.confidence).toBeLessThan(0.7);
    const f = parseName("佐藤");
    expect(f.family.kanji).toBe("佐藤");
    expect(f.given.kanji).toBe("");
  });
  it("rejects empty and oversized input", () => {
    expect(() => parseName("")).toThrow(NameInputError);
    expect(() => parseName("山".repeat(41))).toThrow(NameInputError);
  });
});

describe("parseName – readings", () => {
  it("gives a high-confidence surname reading and candidate given readings", () => {
    const r = parseName("佐藤裕子");
    expect(r.family.readings[0]?.kana).toBe("さとう");
    expect(r.family.confidence).toBe("high");
    const kanas = r.given.readings.map((x) => x.kana);
    expect(kanas).toContain("ゆうこ");
    expect(r.given.readings.length).toBeGreaterThanOrEqual(1);
    expect(["high", "medium", "low"]).toContain(r.given.confidence);
  });
  it("uses provided kana as ground truth and romanizes it", () => {
    const r = parseName("佐藤裕子", "さとう ゆうこ");
    expect(r.family.readings[0]).toMatchObject({ kana: "さとう", source: "provided" });
    expect(r.given.readings[0]).toMatchObject({ kana: "ゆうこ", source: "provided" });
    expect(r.romaji?.passport).toBe("SATO YUKO");
    expect(r.romaji?.basis).toBe("provided-kana");
  });
  it("romanizes from the best guess when no kana is provided, and says so", () => {
    const r = parseName("山田太郎");
    expect(r.romaji?.passport).toBe("YAMADA TARO");
    expect(r.romaji?.basis).toBe("best-guess");
  });
  it("rejects kana that does not have two parts", () => {
    expect(() => parseName("佐藤裕子", "さとうゆうこ")).toThrow(NameInputError);
  });
});
