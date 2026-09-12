import { describe, expect, it } from "vitest";
import {
  convertWareki,
  extractEmails,
  extractPhones,
  extractPostalCodes,
  normalizeText,
  toHalfWidth,
} from "../src/lib/text.js";

describe("toHalfWidth", () => {
  it("converts full-width ASCII and spaces", () => {
    expect(toHalfWidth("ＡＢＣ１２３　ｘ")).toBe("ABC123 x");
  });
  it("converts half-width katakana to full-width", () => {
    expect(toHalfWidth("ｶﾀｶﾅ ﾊﾟﾝ")).toBe("カタカナ パン");
  });
  it("expands parenthesised company marks", () => {
    expect(toHalfWidth("㈱テスト")).toBe("(株)テスト");
  });
});

describe("convertWareki", () => {
  it("converts 令和 with 元年", () => {
    const r = convertWareki("令和元年5月1日に設立");
    expect(r.text).toBe("2019-05-01に設立");
    expect(r.dates).toEqual([{ original: "令和元年5月1日", iso: "2019-05-01" }]);
  });
  it("converts 昭和 and 平成 with abbreviations", () => {
    expect(convertWareki("S63.12.31").text).toBe("1988-12-31");
    expect(convertWareki("H31/4/30").text).toBe("2019-04-30");
    expect(convertWareki("平成３１年４月３０日").text).toBe("2019-04-30");
  });
  it("leaves impossible dates untouched", () => {
    const r = convertWareki("令和2年13月1日");
    expect(r.text).toBe("令和2年13月1日");
    expect(r.dates).toEqual([]);
  });
});

describe("extractPhones", () => {
  it("normalizes domestic numbers to E.164 and national form", () => {
    expect(extractPhones("TEL 03-1234-5678 / 090 1234 5678")).toEqual([
      { original: "03-1234-5678", e164: "+81312345678", national: "0312345678" },
      { original: "090 1234 5678", e164: "+819012345678", national: "09012345678" },
    ]);
  });
  it("handles +81 input", () => {
    expect(extractPhones("+81-3-1234-5678")[0]?.national).toBe("0312345678");
  });
  it("ignores postal codes", () => {
    expect(extractPhones("〒100-0001")).toEqual([]);
  });
});

describe("extractPostalCodes", () => {
  it("finds 〒 and hyphenated forms", () => {
    expect(extractPostalCodes("〒1000001 東京都 / 150-0002")).toEqual(["1000001", "1500002"]);
  });
  it("does not match inside phone numbers", () => {
    expect(extractPostalCodes("03-1234-5678")).toEqual([]);
  });
});

describe("extractEmails", () => {
  it("finds emails including full-width input", () => {
    expect(extractEmails("連絡先: ｉｎｆｏ＠ｅｘａｍｐｌｅ.ｊｐ")).toEqual(["info@example.jp"]);
  });
});

describe("normalizeText", () => {
  it("returns a structured summary", () => {
    const r = normalizeText("令和５年４月１日　ＴＥＬ：０３－１２３４－５６７８　〒１００－０００１");
    expect(r.normalized).toBe("2023-04-01 TEL:03-1234-5678 〒100-0001");
    expect(r.dates[0]?.iso).toBe("2023-04-01");
    expect(r.phones[0]?.e164).toBe("+81312345678");
    expect(r.postalCodes).toEqual(["1000001"]);
  });
});
