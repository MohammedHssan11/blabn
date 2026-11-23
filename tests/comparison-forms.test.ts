import { describe, expect, it } from "vitest";
import { buildEntryPayload, isRequestId, parseOrderCount, safeComparisonPath } from "@/modules/comparisons/forms";

const form = (fields: Record<string, string>, checks: string[] = []) =>
  buildEntryPayload((name) => fields[name] ?? "", (name) => checks.includes(name));

describe("comparison entry form", () => {
  it("turns MAD and orders into the command payload (centimes as text)", () => {
    expect(form({ date: "2026-11-17", sales: "120", orders: "3" })).toEqual({
      date: "2026-11-17", mode: "new", purpose: "live", source: "reporting_only", sales: "12000", orders: "3",
    });
    expect(form({ date: "2026-11-17", sales: "1234.50", orders: "٤٢", source: "pos_export", reference: "sheet" })).toEqual({
      date: "2026-11-17", mode: "new", purpose: "live", source: "pos_export", sales: "123450", orders: "42", reference: "sheet",
    });
  });

  it("a blank field is not entered (never 0); a typed 0 is a real zero", () => {
    expect(form({ date: "2026-11-17", sales: "", orders: "4" })).toEqual({ date: "2026-11-17", mode: "new", purpose: "live", source: "reporting_only", orders: "4" });
    expect(form({ date: "2026-11-17", sales: "0" })?.sales).toBe("0");
    expect(form({ date: "2026-11-17" })).toBeNull();
  });

  it("a correction can withdraw a figure, which sends an explicit blank", () => {
    const payload = form({ date: "2026-11-17", mode: "correct", reason: "wrong day" }, ["clear_sales"]);
    expect(payload).toEqual({ date: "2026-11-17", mode: "correct", purpose: "live", source: "reporting_only", reason: "wrong day", sales: null });
    // The withdraw boxes do nothing for a new figure.
    expect(form({ date: "2026-11-17", orders: "2" }, ["clear_sales"])).not.toHaveProperty("sales");
  });

  it("rejects invalid input before anything is sent", () => {
    expect(form({ date: "2026-11-31", sales: "1" })).toBeNull();
    expect(form({ date: "2026-11-17", sales: "-5" })).toBeNull();
    expect(form({ date: "2026-11-17", sales: "abc" })).toBeNull();
    expect(form({ date: "2026-11-17", orders: "1.5" })).toBeNull();
    expect(form({ date: "2026-11-17", sales: "1", mode: "delete" })).toBeNull();
    expect(form({ date: "2026-11-17", sales: "1", purpose: "other" })).toBeNull();
    expect(form({ date: "2026-11-17", sales: "1", source: "Robert'); drop" })).toBeNull();
    expect(form({ date: "2026-11-17", sales: "1000000000000.00" })).toBeNull();
    expect(parseOrderCount("2147483648")).toBeUndefined();
    expect(parseOrderCount(" 1 200 ")).toBe(1200);
  });

  it("accepts only request identifiers and comparison pages of the same language", () => {
    expect(isRequestId("8c6f3c1e-6e1a-4c0b-9b1a-2f3e4d5c6b7a")).toBe(true);
    expect(isRequestId("not-a-uuid")).toBe(false);
    expect(safeComparisonPath("en", "/en/comparison/entry?date=2026-11-17", "/en/comparison/entry")).toBe("/en/comparison/entry?date=2026-11-17");
    expect(safeComparisonPath("en", "/en/admin/staff", "/en/comparison/entry")).toBe("/en/comparison/entry");
    expect(safeComparisonPath("en", "//evil.example/en/comparison", "/en/comparison/entry")).toBe("/en/comparison/entry");
    expect(safeComparisonPath("en", "/ar/comparison/entry", "/en/comparison/entry")).toBe("/en/comparison/entry");
  });
});
