import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import fixture from "@fixtures/synthetic/phase2.json";
import { buildSeedSql } from "../scripts/phase2/seed-sql";

describe("database seed", () => {
  it("supabase/seed.sql is generated from the synthetic fixture and is up to date", () => {
    const current = readFileSync(path.resolve(__dirname, "../supabase/seed.sql"), "utf8");
    expect(current).toBe(buildSeedSql(fixture));
  });

  it("the fixture is clearly synthetic", () => {
    expect(fixture.notice).toMatch(/SYNTHETIC/);
    expect(fixture.version).toMatch(/synthetic/);
  });
});
