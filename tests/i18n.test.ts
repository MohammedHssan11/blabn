import { describe, expect, it } from "vitest";
import { createTranslator, flattenKeys, getMessages } from "@/i18n/dictionary";
import { directions, isLocale, locales, otherLocale } from "@/i18n/config";
import {
  BLANK,
  formatBusinessDate,
  formatCount,
  formatEventTime,
  formatMad,
  formatMadSigned,
  formatRatio,
} from "@/i18n/format";

describe("translation catalogs", () => {
  it("Arabic and English have exactly the same keys", () => {
    const en = flattenKeys(getMessages("en")).sort();
    const ar = flattenKeys(getMessages("ar")).sort();
    expect(ar).toEqual(en);
    expect(en.length).toBeGreaterThan(100);
  });

  it("no translation is empty", () => {
    for (const locale of locales) {
      for (const key of flattenKeys(getMessages(locale))) {
        const text = createTranslator(locale)(key as never);
        expect(text.trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });

  it("Arabic text is actually Arabic where it should be, and placeholders match", () => {
    const en = createTranslator("en");
    const ar = createTranslator("ar");
    for (const key of flattenKeys(getMessages("en"))) {
      const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(placeholders(ar(key as never)), key).toEqual(placeholders(en(key as never)));
    }
    expect(ar("nav.dailyClose")).toMatch(/[؀-ۿ]/);
    expect(en("nav.dailyClose")).not.toMatch(/[؀-ۿ]/);
  });

  it("interpolates parameters", () => {
    expect(createTranslator("en")("common.phase", { n: 4 })).toBe("Phase 4");
    expect(createTranslator("ar")("common.phase", { n: 4 })).toBe("المرحلة 4");
  });

  it("each language has a direction and a switch target", () => {
    expect(directions).toEqual({ ar: "rtl", en: "ltr" });
    expect(otherLocale("ar")).toBe("en");
    expect(isLocale("fr")).toBe(false);
    // The switch label is the name of the TARGET language in its own language.
    expect(createTranslator("en")("nav.switchTo")).toBe("العربية");
    expect(createTranslator("ar")("nav.switchTo")).toBe("English");
  });
});

/** Intl separates the currency code from the number with a no-break space. */
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("formatting (same saved value, two views)", () => {
  it("formats MAD amounts readably in both languages with Western digits", () => {
    expect(plain(formatMad(100050, "en"))).toBe("MAD 1,000.50");
    const ar = formatMad(100050, "ar");
    expect(ar).toContain("1,000.50");
    expect(ar).toContain("د.م.");
    expect(ar).not.toMatch(/[٠-٩]/);
  });

  it("shows blank as a dash and zero as 0.00", () => {
    expect(formatMad(null, "en")).toBe(BLANK);
    expect(formatMad(null, "ar")).toBe(BLANK);
    expect(plain(formatMad(0, "en"))).toBe("MAD 0.00");
    expect(formatCount(null, "en")).toBe(BLANK);
    expect(formatCount(0, "en")).toBe("0");
    expect(formatRatio(null, "en")).toBe(BLANK);
    expect(formatRatio(0, "en")).toBe("0%");
  });

  it("formats ratios: 120 % and fractions", () => {
    expect(formatRatio(12000, "en")).toBe("120%");
    expect(formatRatio(12000, "ar")).toContain("120");
    expect(formatRatio(3333, "en")).toBe("33.3%");
  });

  it("formats a signed variance of +3 MAD and leaves a zero unsigned", () => {
    expect(plain(formatMadSigned(300, "en"))).toBe("+MAD 3.00");
    expect(formatMadSigned(-300, "en")).toContain("3.00");
    expect(plain(formatMadSigned(0, "en"))).toBe("MAD 0.00");
    expect(formatMadSigned(300, "ar")).toContain("3.00");
  });

  it("formats business dates without shifting the day, in both languages", () => {
    expect(formatBusinessDate("2026-11-02", "en")).toBe("Monday, November 2, 2026");
    expect(formatBusinessDate("2026-11-02", "en", "short")).toBe("Nov 2");
    const ar = formatBusinessDate("2026-11-02", "ar");
    expect(ar).toContain("2026");
    expect(ar).toMatch(/[؀-ۿ]/);
    expect(formatBusinessDate("2026-12-31", "en", "short")).toBe("Dec 31");
    expect(formatBusinessDate(null, "en")).toBe(BLANK);
  });

  it("formats event times in the branch timezone", () => {
    expect(formatEventTime("2026-11-02T21:00:00Z", "en", "Africa/Casablanca")).toBe("22:00");
    expect(formatEventTime("2026-11-02T21:00:00Z", "ar", "Africa/Casablanca")).toBe("22:00");
    expect(formatEventTime("2026-11-02T21:00:00Z", "en", "UTC")).toBe("21:00");
  });
});
