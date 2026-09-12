import { describe, expect, it } from "vitest";
import {
  BankInputError,
  canonicalBankName,
  canonicalBranchName,
  canonicalKana,
  lookupBank,
  resolveBank,
  resolveBranch,
  toHalfWidthKana,
} from "../src/lib/bank.js";

describe("canonical forms", () => {
  it("strips legal forms and maps institution types to zengin style", () => {
    expect(canonicalBankName("株式会社みずほ銀行")).toBe("みずほ");
    expect(canonicalBankName("三菱ＵＦＪ銀行")).toBe("三菱UFJ");
    expect(canonicalBankName("京都中央信用金庫")).toBe("京都中央信金");
    expect(canonicalBankName("横浜幸銀信用組合")).toBe("横浜幸銀信組");
    expect(canonicalBankName("北海道労働金庫")).toBe("北海道労金");
    expect(canonicalBankName("JA横浜")).toBe("横浜農協");
    expect(canonicalBankName("ＪＡかとり農業協同組合")).toBe("かとり農協");
    expect(canonicalBankName("ゆうちょ銀行")).toBe("ゆうちょ");
  });
  it("strips 支店 but keeps 出張所, and reads numerals both ways", () => {
    expect(canonicalBranchName("新宿支店")).toBe("新宿");
    expect(canonicalBranchName("大栄出張所")).toBe("大栄出張所");
    expect(canonicalBranchName("一〇八")).toBe("108");
    expect(canonicalBranchName("１０８")).toBe("108");
  });
  it("normalizes kana to zengin style (katakana, no small kana, no long vowel)", () => {
    expect(canonicalKana("ミツビシユーエフジェイ")).toBe("ミツビシユエフジエイ");
    expect(canonicalKana("みずほ")).toBe("ミズホ");
    expect(canonicalKana("シンジュク")).toBe("シンジユク");
  });
});

describe("toHalfWidthKana (全銀フォーマット用)", () => {
  it("converts full-width katakana incl. dakuten and long vowel", () => {
    expect(toHalfWidthKana("ミズホ")).toBe("ﾐｽﾞﾎ");
    expect(toHalfWidthKana("ミツビシユ－エフジエイ")).toBe("ﾐﾂﾋﾞｼﾕｰｴﾌｼﾞｴｲ");
    expect(toHalfWidthKana("パンダ・カ")).toBe("ﾊﾟﾝﾀﾞ･ｶ");
  });
});

describe("lookupBank", () => {
  it("returns bank and branch by code", () => {
    const r = lookupBank("0001", "001");
    expect(r?.bank.name).toBe("みずほ");
    expect(r?.bank.kind).toBe("bank");
    expect(r?.branch?.name).toBe("東京営業部");
    expect(r?.branch?.kanaHalfWidth).toBe("ﾄｳｷﾖｳ");
  });
  it("classifies institution kinds by code range", () => {
    expect(lookupBank("1611")?.bank.kind).toBe("shinkin");
    expect(lookupBank("2951")?.bank.kind).toBe("rokin");
    expect(lookupBank("5000")?.bank.kind).toBe("ja-jf");
    expect(lookupBank("9900")?.bank.kind).toBe("jp-bank");
  });
  it("returns null for unknown codes and rejects malformed ones", () => {
    expect(lookupBank("0000")).toBeNull();
    expect(lookupBank("0001", "999")?.branch).toBeNull();
    expect(() => lookupBank("1")).toThrow(BankInputError);
  });
});

describe("resolveBank", () => {
  it("resolves common notations to the right code with confidence", () => {
    for (const [q, code] of [
      ["みずほ銀行", "0001"],
      ["三菱UFJ銀行", "0005"],
      ["三菱ＵＦＪ", "0005"],
      ["ミツビシユーエフジェイ", "0005"],
      ["三井住友", "0009"],
      ["ゆうちょ銀行", "9900"],
      ["JA横浜", "5114"],
      ["京都中央信用金庫", "1611"],
      ["横浜銀行", "0138"],
      ["PayPay銀行", "0033"],
      ["mizuho", "0001"],
    ] as const) {
      const r = resolveBank(q);
      expect(r.candidates[0]?.code, q).toBe(code);
      expect(r.confident, q).toBe(true);
    }
  });
  it("is honest when ambiguous", () => {
    const r = resolveBank("横浜");
    expect(r.candidates.length).toBeGreaterThan(1);
    expect(r.candidates[0]?.code).toBe("0138"); // exact name match ranks first
  });
  it("rejects empty / long input", () => {
    expect(() => resolveBank("")).toThrow(BankInputError);
    expect(() => resolveBank("あ".repeat(101))).toThrow(BankInputError);
  });
});

describe("resolveBranch", () => {
  it("finds branches by kanji, kana, and with 支店 suffix", () => {
    expect(resolveBranch("0001", "新宿支店").candidates[0]?.code).toBe("240");
    expect(resolveBranch("0001", "シンジュク").candidates[0]?.code).toBe("240");
    expect(resolveBranch("0001", "新宿西口").candidates[0]?.code).toBe("353");
    expect(resolveBranch("0009", "渋谷駅前支店").candidates[0]?.code).toBe("234");
  });
  it("handles ゆうちょ numeric branch names", () => {
    expect(resolveBranch("9900", "108").candidates[0]?.code).toBe("108");
    expect(resolveBranch("9900", "一〇八").candidates[0]?.code).toBe("108");
  });
  it("throws for an unknown bank code", () => {
    expect(() => resolveBranch("0000", "新宿")).toThrow(BankInputError);
  });
});
