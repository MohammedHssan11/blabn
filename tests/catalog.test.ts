import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createTranslator, flattenKeys, getMessages } from "@/i18n/dictionary";
import {
  fractionToDecimal, fractionToInput, isCatalogId, mapCatalogError, normalizeQuantityInput, parseConsumptionLines, safeCatalogPath, sameFraction,
  REASON_CODES, REVIEW_KINDS,
} from "@/modules/catalog/forms";
// @ts-expect-error plain ES module used by the seed script
import { buildCatalogSeed, labelKey } from "../scripts/phase5/build-catalog-seed.mjs";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replaceAll("\r\n", "\n");

describe("quantity input", () => {
  it("accepts decimals, fractions and Arabic digits, and keeps them exact", () => {
    expect(normalizeQuantityInput("0.025")).toBe("0.025");
    expect(normalizeQuantityInput(" 1/30 ")).toBe("1/30");
    expect(normalizeQuantityInput("٢٤")).toBe("24");
    expect(normalizeQuantityInput("٠٫٠٦")).toBe("0.06");
    expect(normalizeQuantityInput("0,5")).toBe("0.5");
  });
  it("refuses zero, negatives, text and oversized numbers", () => {
    for (const bad of ["0", "0.000", "-1", "abc", "", "1/0", "0/5", "1e3", "1.2.3", "9".repeat(19)]) expect(normalizeQuantityInput(bad), bad).toBeNull();
  });
  it("round-trips large and fractional values through the editor", () => {
    for (const [num, den, text] of [
      ["9007199254740993", "1", "9007199254740993"],
      ["9007199254740993000000000000001", "1000000000000000", "9007199254740993.000000000000001"],
      ["1", "30", "1/30"],
    ] as const) {
      expect(fractionToInput(num, den)).toBe(text);
      expect(normalizeQuantityInput(text)).toBe(text);
    }
  });

  it("accepts UUIDs only with the expected dash positions", () => {
    expect(isCatalogId("E131E6CC-1403-5808-99A4-12F0D4935026")).toBe(true);
    expect(isCatalogId("-".repeat(36))).toBe(false);
  });

  it("prints a fraction as the database does and flags rounding", () => {
    expect(fractionToDecimal(1, 30)).toEqual({ text: "0.033333333", exact: false });
    expect(fractionToDecimal(21, 10)).toEqual({ text: "2.1", exact: true });
    expect(fractionToDecimal(2, 3).text).toBe("0.666666667");
    expect(fractionToDecimal("9007199254740993", 1).text).toBe("9007199254740993");
    expect(sameFraction({ num: 3, den: 5 }, { num: "6", den: "10" })).toBe(true);
    expect(sameFraction({ num: 1, den: 3 }, { num: 33, den: 100 })).toBe(false);
  });
});

describe("sold lines typed for the consumption check", () => {
  it("reads «name | quantity», tabs, semicolons and a trailing number", () => {
    const { lines, unreadable } = parseConsumptionLines("بظابيظو مانجو كبير | 3\nالغوريلا\t70\nسوبر الملوك;52\nقشطوطة كراميل 16\n\n");
    expect(unreadable).toEqual([]);
    expect(lines).toEqual([
      { label: "بظابيظو مانجو كبير", quantity: "3" }, { label: "الغوريلا", quantity: "70" },
      { label: "سوبر الملوك", quantity: "52" }, { label: "قشطوطة كراميل", quantity: "16" },
    ]);
  });
  it("keeps an unreadable row, flagged, so it is blocked with its own reason instead of vanishing", () => {
    const { lines, unreadable } = parseConsumptionLines("good | 1\nno quantity here\nbad | x");
    expect(unreadable).toEqual([2, 3]);
    expect(lines).toHaveLength(3);
  });
});

describe("where a catalog form may send a person back to", () => {
  it("accepts only catalog pages of the same language", () => {
    const fallback = "/en/catalog";
    expect(safeCatalogPath("en", "/en/catalog/review?kind=unit_conflict#x", fallback)).toBe("/en/catalog/review?kind=unit_conflict");
    for (const bad of ["//evil.example/en/catalog", "/ar/catalog", "https://evil.example", "/en/admin/staff", "/en/catalog\\..", "/en/catalog/../admin/staff", "/en/catalogue", "/en/catalog\r\nSet-Cookie: x", null, undefined, ""]) {
      expect(safeCatalogPath("en", bad as string, fallback), String(bad)).toBe(fallback);
    }
  });
  it("turns a database refusal into a message code", () => {
    expect(mapCatalogError("42501")).toBe("forbidden");
    expect(mapCatalogError("40001")).toBe("catalog_stale");
    expect(mapCatalogError("23505")).toBe("catalog_duplicate");
    expect(mapCatalogError("23P01")).toBe("catalog_overlap");
    expect(mapCatalogError("CT001")).toBe("catalog_date_unconfirmed");
    expect(mapCatalogError("CT002")).toBe("catalog_incomplete");
    expect(mapCatalogError("CT003")).toBe("catalog_unit");
    expect(mapCatalogError("22023")).toBe("invalid_input");
    expect(mapCatalogError("08006")).toBe("unavailable");
    expect(mapCatalogError(undefined)).toBe("unavailable");
  });
});

describe("messages cover every code the screens can show", () => {
  const en = getMessages("en");
  it("has a reason, a review-kind title and help, and an error for each code", () => {
    for (const code of REASON_CODES) expect(en.catalog.consumption.reason, code).toHaveProperty(code);
    for (const kind of REVIEW_KINDS) expect(en.catalog.review.kinds[kind], kind).toHaveProperty("help");
    for (const code of ["catalog_stale", "catalog_duplicate", "catalog_overlap", "catalog_date_unconfirmed", "catalog_incomplete", "catalog_unit"]) {
      expect(en.errors).toHaveProperty(code);
    }
  });
  it("audits every catalog action in both languages", () => {
    const migration = read("supabase/migrations/20261122120000_phase5_catalog_recipes.sql");
    const actions = [...migration.matchAll(/'(catalog\.[a-z_]+)'/g)].map((m) => m[1]!.replace(".", "_"));
    expect(actions.length).toBeGreaterThanOrEqual(12);
    for (const locale of ["en", "ar"] as const) {
      const audit = getMessages(locale).audit.action as Record<string, string>;
      for (const action of new Set(actions)) expect(audit, `${locale}:${action}`).toHaveProperty(action);
    }
  });
  it("the Arabic question for Abdo is the exact wording he was asked", () => {
    expect(createTranslator("ar")("catalog.review.dateAnswer")).toBeTruthy();
    expect(read("scripts/phase5/build-catalog-seed.mjs")).toContain("نسخة وصفات نوفمبر بدأ العمل بيها من يوم كام؟");
    expect(flattenKeys(getMessages("ar")).filter((k) => k.startsWith("catalog.")).length).toBe(flattenKeys(getMessages("en")).filter((k) => k.startsWith("catalog.")).length);
  });
});

describe("the catalog seed", () => {
  const fixture = JSON.parse(read("fixtures/catalog/legacy-catalog.json"));
  it("is generated from the fixture (no drift)", () => {
    expect(read("supabase/seed_catalog.sql")).toBe(buildCatalogSeed(fixture));
  });
  it("loads every recipe as a draft and approves nothing but Abdo's cake alias", () => {
    const sql = read("supabase/seed_catalog.sql");
    expect(sql).not.toMatch(/'approved'[^;]*recipe_versions/);
    const versions = sql.slice(sql.indexOf("insert into public.recipe_versions"));
    expect(versions.split("insert into public.recipe_lines")[0]).not.toContain("'approved'");
    const foodicsApproved = [...sql.matchAll(/\('[^']+', '[^']+', 'foodics', '([^']+)', '[^']+', 'approved'/g)].map((m) => m[1]);
    expect(foodicsApproved.sort()).toEqual(["كيكة الهبة دبي شيكولاتة كبير", "كيكة الهبة دبي شيكولاتة كبيرة"]);
  });
  it("carries the confirmed cases with their evidence", () => {
    const nuts = fixture.versions.flatMap((v: { lines: Array<Record<string, any>> }) => v.lines).filter((l: Record<string, any>) => l.component === "مكسرات مشكلة" && l.unit_label === "عدد");
    expect(nuts).toHaveLength(20 / 2 + 0); // ten rows per workbook are shared by identical versions
    expect(nuts.every((l: Record<string, any>) => l.unit_code === "kg" && l.unit_resolution === "abdo_p1_31")).toBe(true);
    const spoons = fixture.versions.flatMap((v: any) => v.lines.map((l: any) => ({ ...v, line: l }))).filter((x: any) => x.line.unit_resolution === "abdo_p1_32_spoons");
    expect(spoons).toHaveLength(1);
    expect(spoons[0].line).toMatchObject({ row: 1015, month: "nov", component: "ملاعق بلاستيك للارز - مستورد", quantity: { num: 6, den: 1 }, unit_code: "pc" });
    expect(spoons[0].label).toBe("November workbook");
    expect(fixture.sources.nov.id).toBe("SRC-07");
  });
  it("never rounds a recipe quantity: every stored quantity is an exact fraction", () => {
    for (const v of fixture.versions) for (const l of v.lines) if (l.quantity) {
      expect(Number.isInteger(l.quantity.num) && Number.isInteger(l.quantity.den) && l.quantity.den > 0 && l.quantity.num > 0).toBe(true);
    }
    const third = fixture.versions.flatMap((v: any) => v.lines).find((l: any) => l.quantity?.den === 30);
    expect(third.quantity).toMatchObject({ num: 1, den: 30 });
  });
  it("folds Arabic spelling variants the way the database does", () => {
    expect(labelKey("كَيكة  الهبة ١")).toBe("كيكه الهبه 1");
    expect(labelKey("أيس كريم")).toBe(labelKey("ايس كريم"));
    expect(labelKey("كيكة الهبة دبي شيكولاتة كبير")).not.toBe(labelKey("كيكة الهبة دبي شيكولاتة كبيرة"));
  });
});

describe("Phase 5 guard rails (static)", () => {
  const actions = read("src/modules/catalog/actions.ts");
  const bodies = actions.split(/^export async function /m).slice(1);
  it("every catalog action authorizes before it reads or writes, and asks for recipes.manage", () => {
    expect(bodies.length).toBeGreaterThanOrEqual(12);
    expect(actions).toMatch(/permission: "recipes\.manage"/);
    expect(actions).toMatch(/async function begin[\s\S]*requireAccess\(/);
    for (const body of bodies) {
      const guard = body.indexOf("await begin(");
      expect(guard, body.slice(0, 40)).toBeGreaterThan(-1);
      for (const marker of [".rpc(", ".from(", "createUserClient("]) {
        const at = body.indexOf(marker);
        if (at !== -1) expect(guard).toBeLessThan(at);
      }
    }
    expect(actions.startsWith('"use server";')).toBe(true);
    expect([...actions.matchAll(/^export (?!async function)(.*)$/gm)]).toEqual([]);
  });
  it("every catalog page asks for recipes.manage", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const pages = walk(path.join(ROOT, "src/app/[locale]/catalog")).filter((f) => f.endsWith("page.tsx"));
    expect(pages.length).toBe(7);
    for (const page of pages) expect(readFileSync(page, "utf8"), page).toMatch(/permission: "recipes\.manage"/);
  });
  it("the data layer never writes: it reads tables and calls only the eligibility check", () => {
    const data = read("src/modules/catalog/data.ts");
    expect(data).not.toMatch(/\.(insert|update|delete|upsert)\(/);
    expect([...data.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1])).toEqual(["app_catalog_consumption"]);
  });
  it("the migration is forward-only and leaves no table writable by an API role", () => {
    const sql = read("supabase/migrations/20261122120000_phase5_catalog_recipes.sql");
    expect(sql).not.toMatch(/drop (table|function|policy)/i);
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*to[^;]*(anon|authenticated)/i);
    const tables = [...sql.matchAll(/create table public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(tables).toHaveLength(8);
    for (const table of tables) expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`));
  });
});
