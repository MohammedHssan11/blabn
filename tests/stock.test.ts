import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GROUP_PERMISSIONS } from "@/modules/access/catalog";
import {
  buildStockPayload, normalizeCountInput, normalizeStockQuantity, safeInventoryPath, stockPermission, STOCK_COMMANDS,
} from "@/modules/inventory/stock-forms";

const ITEM = "0b6f6a8e-6b1e-4e8c-9d1a-3c1f9b2a7d10";
const fields = (values: Record<string, string>) => (name: string) => values[name] ?? "";

describe("stock form parsing", () => {
  it("keeps a blank count blank and an explicit zero a count", () => {
    expect(normalizeCountInput("")).toBeNull();
    expect(normalizeCountInput("   ")).toBeNull();
    expect(normalizeCountInput("0")).toBe("0");
    expect(normalizeCountInput("0.00")).toBe("0");
    expect(normalizeCountInput("٠")).toBe("0");
    expect(normalizeCountInput("١٢٫٥")).toBe("12.5");
    expect(normalizeCountInput("-1")).toBeNull();
    expect(normalizeCountInput("abc")).toBeNull();
  });

  it("requires a positive quantity for movements", () => {
    expect(normalizeStockQuantity("0")).toBeNull();
    expect(normalizeStockQuantity("5")).toBe("5");
    expect(normalizeStockQuantity("0.25")).toBe("0.25");
    expect(normalizeStockQuantity("1/3")).toBeNull(); // fractions are for recipes; stock entries are decimals
  });

  it("builds the count payload only with an item, a quantity and a time", () => {
    expect(buildStockPayload("count", fields({ item: ITEM, quantity: "", local: "2026-11-10T23:00" }))).toBeNull();
    expect(buildStockPayload("count", fields({ item: ITEM, quantity: "0", local: "2026-11-10T23:00" }))).toMatchObject({ item: ITEM, quantity: "0" });
    expect(buildStockPayload("count", fields({ item: "x", quantity: "1", local: "2026-11-10T23:00" }))).toBeNull();
  });

  it("converts Product Mix amounts to centimes and refuses negative ones", () => {
    expect(buildStockPayload("mix_line", fields({ section_no: "1", label: "كيكة", quantity: "2", amount: "20.50", version: "3" })))
      .toEqual({ section_no: 1, label: "كيكة", quantity: "2", amount: "2050", version: 3 });
    expect(buildStockPayload("mix_line", fields({ section_no: "1", label: "كيكة", quantity: "2", amount: "-1", version: "3" }))).toBeNull();
    expect(buildStockPayload("mix_save", fields({ net_sales: "1000", local: "2026-11-10T23:00" }))).toEqual({ net_sales: "100000", local: "2026-11-10T23:00" });
  });

  it("needs a reason to reverse, void or adjust", () => {
    expect(buildStockPayload("reverse", fields({ posting: ITEM }))).toBeNull();
    expect(buildStockPayload("void_count", fields({ count: ITEM }))).toBeNull();
    expect(buildStockPayload("propose_adjustment", fields({ item: ITEM, quantity: "1", direction: "-1", local: "2026-11-10T23:00" }))).toBeNull();
    expect(buildStockPayload("reverse", fields({ posting: ITEM, reason: "returned" }))).toEqual({ posting: ITEM, reason: "returned" });
  });

  it("only accepts manual movement types", () => {
    expect(buildStockPayload("movement", fields({ kind: "consumption", item: ITEM, quantity: "1", local: "2026-11-10T10:00" }))).toBeNull();
    expect(buildStockPayload("movement", fields({ kind: "adjustment", item: ITEM, quantity: "1", local: "2026-11-10T10:00" }))).toBeNull();
    expect(buildStockPayload("movement", fields({ kind: "receipt", item: ITEM, quantity: "1", local: "2026-11-10T10:00" }))).toMatchObject({ kind: "receipt" });
  });

  it("keeps return addresses on the stock pages of the same language", () => {
    expect(safeInventoryPath("en", "/en/inventory?date=2026-11-10", "/en/inventory")).toBe("/en/inventory?date=2026-11-10");
    expect(safeInventoryPath("en", "/en/inventory/product-mix?date=2026-11-10", "/x")).toBe("/en/inventory/product-mix?date=2026-11-10");
    for (const bad of ["//evil.example/en/inventory", "https://evil.example/en/inventory", "/ar/inventory", "/en/inventoryx", "/en/inventory\r\nx", "/en/admin/staff"]) {
      expect(safeInventoryPath("en", bad, "/en/inventory")).toBe("/en/inventory");
    }
  });
});

describe("stock permissions mirror the database command", () => {
  const sql = readFileSync(path.resolve(__dirname, "../supabase/migrations/20261123120000_phase6_stock.sql"), "utf8").replaceAll("\r\n", "\n");

  it("names every command the database accepts", () => {
    for (const command of STOCK_COMMANDS) expect(sql, command).toContain(`'${command}'`);
  });

  it("maps each command to the permission the database checks", () => {
    expect(stockPermission("movement", "receipt")).toBe("inventory.receive");
    expect(stockPermission("movement", "waste")).toBe("inventory.waste");
    expect(stockPermission("movement", "hospitality")).toBe("inventory.hospitality");
    expect(stockPermission("movement", "transfer_out")).toBe("inventory.adjust");
    expect(stockPermission("movement", "consumption")).toBeNull();
    expect(stockPermission("opening")).toBe("inventory.adjust_approve");
    expect(stockPermission("decide_adjustment")).toBe("inventory.adjust_approve");
    expect(stockPermission("count")).toBe("inventory.count");
    expect(stockPermission("post_consumption")).toBe("inventory.consume");
    expect(stockPermission("mix_line")).toBe("inventory.consume");
  });

  it("gives the cashier nothing in stock and the storekeeper Product Mix entry", () => {
    expect(GROUP_PERMISSIONS.cashier.some((p) => p.startsWith("inventory."))).toBe(false);
    expect(GROUP_PERMISSIONS.storekeeper).toContain("inventory.consume");
    expect(GROUP_PERMISSIONS.storekeeper).not.toContain("inventory.adjust_approve");
    expect(GROUP_PERMISSIONS.manager).toEqual(expect.arrayContaining(["inventory.adjust_approve", "inventory.consume"]));
  });

  it("keeps the stock history append-only and posts consumption only through an approved recipe", () => {
    for (const table of ["stock_postings", "stock_movements", "stock_consumption_lines", "stock_counts", "stock_count_voids"]) {
      expect(sql).toContain(`'${table}'`);
    }
    expect(sql).toMatch(/create trigger recipe_versions_keep_postings before update of effective_to on public\.recipe_versions/);
    expect(sql).toMatch(/res := app_private\.catalog_consumption\(p_branch, p_date, mix_input\)/);
    expect(sql).toMatch(/unique \(branch_id, request_id\)/);
  });
});
