import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/lib/csv.js";
import { HojinClient, isValidCorporateNumber, parseHojinCsv } from "../src/lib/hojin.js";

const BOM = "﻿";
const SAMPLE =
  `${BOM}2019-04-05,2,1,1\n` +
  '1,4111101000007,01,1,2019-04-03,2015-10-05,"株式会社検索対象除外のち所在地変更により検索対象",,301,"東京都","千代田区","（東京市神田区小川町一丁目２０番地）\n",,13,101,1000000,,,,,,,2015-10-05,0,,,,,,0\n' +
  '2,4111101000007,12,1,2019-04-05,2019-04-04,"株式会社検索対象除外のち所在地変更により検索対象",,301,"東京都","千代田区","神田小川町１丁目２０番地",,13,101,1010052,,,,,,,2015-10-05,1,,,,,,0\n';

describe("parseCsv", () => {
  it("handles quotes, embedded commas and newlines", () => {
    expect(parseCsv('a,"b,c","d""e","f\ng"\n1,2,3,4')).toEqual([
      ["a", "b,c", 'd"e', "f\ng"],
      ["1", "2", "3", "4"],
    ]);
  });
});

describe("parseHojinCsv", () => {
  it("parses the NTA sample (BOM + header + 2 history rows)", () => {
    const r = parseHojinCsv(SAMPLE);
    expect(r.header).toEqual({ lastUpdateDate: "2019-04-05", count: 2, divideNumber: 1, divideSize: 1 });
    expect(r.corporations).toHaveLength(2);
    const latest = r.corporations[1]!;
    expect(latest.corporateNumber).toBe("4111101000007");
    expect(latest.kind).toBe("301");
    expect(latest.postCode).toBe("1010052");
    expect(latest.latest).toBe("1");
    expect(latest.streetNumber).toBe("神田小川町１丁目２０番地");
  });
  it("rejects malformed rows", () => {
    expect(() => parseHojinCsv("2019-04-05,1,1,1\n1,2,3\n")).toThrow(/expected 30 fields/);
  });
});

describe("isValidCorporateNumber", () => {
  it("accepts numbers from the NTA spec samples", () => {
    expect(isValidCorporateNumber("5111101000006")).toBe(true);
    expect(isValidCorporateNumber("4111101000007")).toBe(true);
    expect(isValidCorporateNumber("2040001999902")).toBe(true);
  });
  it("rejects wrong check digit / format", () => {
    expect(isValidCorporateNumber("1111101000006")).toBe(false);
    expect(isValidCorporateNumber("12345")).toBe(false);
  });
});

describe("HojinClient", () => {
  it("builds the request URL and parses the response", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      return new Response(SAMPLE, { status: 200 });
    };
    const client = new HojinClient("APPID", fetchImpl);
    const r = await client.byNumber(["4111101000007"], true);
    expect(r.corporations).toHaveLength(2);
    const u = new URL(calls[0]!);
    expect(u.pathname).toBe("/4/num");
    expect(u.searchParams.get("id")).toBe("APPID");
    expect(u.searchParams.get("type")).toBe("02");
    expect(u.searchParams.get("history")).toBe("1");
  });
  it("surfaces HTTP errors", async () => {
    const client = new HojinClient("APPID", async () => new Response("bad id", { status: 400 }));
    await expect(client.byName("テスト")).rejects.toThrow(/NTA API 400/);
  });
});
