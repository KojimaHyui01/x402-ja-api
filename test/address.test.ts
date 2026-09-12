import { describe, expect, it } from "vitest";
import { AddressInputError, normalizeAddress } from "../src/lib/address.js";

describe("normalizeAddress (integration: fetches Geolonia address data)", () => {
  it("parses full-width input down to town level with coordinates", async () => {
    const r = await normalizeAddress("東京都千代田区千代田１−１");
    expect(r.pref).toBe("東京都");
    expect(r.city).toBe("千代田区");
    expect(r.town).toBe("千代田");
    expect(r.level).toBeGreaterThanOrEqual(3);
    expect(r.point?.lat).toBeGreaterThan(35);
    expect(r.point?.lng).toBeGreaterThan(139);
  }, 30_000);

  it("absorbs notation variants and reaches block level (level 8)", async () => {
    const r = await normalizeAddress("北海道札幌市西区24-2-2-3-3");
    expect(r.town).toBe("二十四軒二条二丁目");
    expect(r.addr).toBe("3-3");
    expect(r.level).toBe(8);
    expect(r.formatted).toBe("北海道札幌市西区二十四軒二条二丁目3-3");
  }, 30_000);

  it("rejects empty and oversized input", async () => {
    await expect(normalizeAddress("   ")).rejects.toBeInstanceOf(AddressInputError);
    await expect(normalizeAddress("あ".repeat(201))).rejects.toBeInstanceOf(AddressInputError);
  });
});
