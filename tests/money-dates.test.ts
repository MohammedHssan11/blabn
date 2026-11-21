import { describe, expect, it } from "vitest";
import {
  MAX_MINOR,
  averageMinor,
  growthBp,
  parseMadInput,
  ratioBp,
  roundDiv,
  sumMinor,
  toDecimalString,
  toMinor,
} from "@/lib/money";
import { addDays, businessDateOf, daysInMonth, isBusinessDate, isMonth } from "@/lib/dates";

describe("money", () => {
  it("converts decimal strings to exact minor units", () => {
    expect(toMinor("1000.50")).toBe(100050);
    expect(toMinor("0.1")).toBe(10);
    expect(toMinor("603")).toBe(60300);
    expect(toMinor(1.15)).toBe(115);
    expect(toDecimalString(60350)).toBe("603.50");
    expect(toDecimalString(-5)).toBe("-0.05");
    expect(() => toMinor("12.345")).toThrow();
  });

  it("rounds half away from zero", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(roundDiv(100000, 3)).toBe(33333);
    expect(roundDiv(200000, 3)).toBe(66667);
  });

  it("keeps blank (null) different from zero", () => {
    expect(averageMinor(100000, 10)).toBe(10000);
    expect(averageMinor(100000, 0)).toBeNull();
    expect(averageMinor(100000, null)).toBeNull();
    expect(averageMinor(null, 10)).toBeNull();
    expect(averageMinor(0, 3)).toBe(0); // zero sales with orders is a real 0.00
    expect(sumMinor([100, null, 50])).toBe(150);
  });

  it("calculates ratios in basis points without float error", () => {
    expect(ratioBp(12000, 10000)).toBe(12000); // 120 vs 100 -> 120 %
    expect(ratioBp(1, 3)).toBe(3333);
    expect(ratioBp(100, 0)).toBeNull();
    expect(ratioBp(100, null)).toBeNull();
    expect(ratioBp(null, 100)).toBeNull();
    expect(ratioBp(0, 100)).toBe(0);
  });

  it("calculates growth; a recorded zero gives -100 %", () => {
    expect(growthBp(12000, 10000)).toBe(2000);
    expect(growthBp(0, 10000)).toBe(-10000);
    expect(growthBp(null, 10000)).toBeNull();
    expect(growthBp(100, 0)).toBeNull();
  });

  it("parses typed amounts: blank, western and Arabic-Indic digits, separators", () => {
    expect(parseMadInput("")).toBeNull();
    expect(parseMadInput("   ")).toBeNull();
    expect(parseMadInput(undefined)).toBeNull();
    expect(parseMadInput("0")).toBe(0);
    expect(parseMadInput("603")).toBe(60300);
    expect(parseMadInput("603,5")).toBe(60350);
    expect(parseMadInput("٦٠٣٫٥٠")).toBe(60350);
    expect(parseMadInput("1 234.56")).toBe(123456);
    expect(parseMadInput("abc")).toBeUndefined();
    expect(parseMadInput("12.345")).toBeUndefined();
    expect(parseMadInput("-3")).toBe(-300);
    expect(Object.is(parseMadInput("-0"), 0)).toBe(true);
  });

  it("rejects amounts outside numeric(14,2) before they reach the calculation", () => {
    expect(MAX_MINOR).toBe(99_999_999_999_999);
    // the largest valid amount, in every supported input format
    expect(parseMadInput("999999999999.99")).toBe(MAX_MINOR);
    expect(parseMadInput("999,999,999,999.99")).toBeUndefined(); // "," is a decimal mark, not a thousands mark
    expect(parseMadInput("999 999 999 999,99")).toBe(MAX_MINOR);
    expect(parseMadInput("٩٩٩٩٩٩٩٩٩٩٩٩٫٩٩")).toBe(MAX_MINOR);
    expect(parseMadInput("999999999999")).toBe(99_999_999_999_900);
    expect(parseMadInput("000000999999999999.99")).toBe(MAX_MINOR); // leading zeros are not digits of the value
    // one cent above the maximum is exactly 1,000,000,000,000.00
    expect(parseMadInput("1000000000000.00")).toBeUndefined();
    expect(parseMadInput("1000000000000.01")).toBeUndefined();
    expect(parseMadInput("1000000000000")).toBeUndefined();
    expect(parseMadInput("١٠٠٠٠٠٠٠٠٠٠٠٠٫٠٠")).toBeUndefined();
    // the negative side has the same bound
    expect(Math.abs(parseMadInput("-999999999999.99") ?? 0)).toBe(MAX_MINOR);
    expect(parseMadInput("-1000000000000.00")).toBeUndefined();
    // large enough to overflow a JavaScript number (more than 308 digits)
    const huge = "9".repeat(400);
    expect(Number(huge)).toBe(Infinity);
    expect(parseMadInput(huge)).toBeUndefined();
    expect(parseMadInput(`${huge}.99`)).toBeUndefined();
    expect(parseMadInput(`-${huge}`)).toBeUndefined();
    expect(parseMadInput("٩".repeat(400))).toBeUndefined();
    // a number that is exact only as a string stays rejected (no rounding into range)
    expect(parseMadInput("1".padEnd(30, "0"))).toBeUndefined();
    // blank, explicit zero and ordinary amounts keep working
    expect(parseMadInput("")).toBeNull();
    expect(parseMadInput("0")).toBe(0);
    expect(parseMadInput("0.00")).toBe(0);
  });
});

describe("dates", () => {
  it("validates business dates and months", () => {
    expect(isBusinessDate("2026-11-02")).toBe(true);
    expect(isBusinessDate("2026-02-30")).toBe(false);
    expect(isBusinessDate("02/11/2026")).toBe(false);
    expect(isBusinessDate(undefined)).toBe(false);
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-11-10", -7)).toBe("2026-11-03");
    expect(addDays("2026-11-03", -7)).toBe("2026-10-27");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysInMonth("2026-11")).toHaveLength(30);
    expect(daysInMonth("2026-02")).toHaveLength(28);
  });

  it("derives the business date from the branch timezone, not the server zone", () => {
    const tz = "Africa/Casablanca";
    // 23:30 UTC on 2 Nov is 00:30 on 3 Nov in Casablanca (UTC+1).
    expect(businessDateOf("2026-11-02T23:30:00Z", tz)).toBe("2026-11-03");
    expect(businessDateOf("2026-11-02T21:00:00Z", tz)).toBe("2026-11-02");
  });

  it("applies the rollover time: an event after midnight still belongs to the previous business day", () => {
    const tz = "Africa/Casablanca";
    expect(businessDateOf("2026-11-03T00:20:00+01:00", tz, "04:00")).toBe("2026-11-02");
    expect(businessDateOf("2026-11-03T04:00:00+01:00", tz, "04:00")).toBe("2026-11-03");
    expect(businessDateOf("2026-11-03T00:20:00+01:00", tz, "00:00")).toBe("2026-11-03");
  });
});
