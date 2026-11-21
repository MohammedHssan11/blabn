// Regenerates supabase/seed.sql from fixtures/synthetic/phase2.json.
// Usage: node scripts/phase2/build-seed.mjs [--check]
//   --check  fail (exit 1) when supabase/seed.sql is not up to date
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixturePath = path.join(root, "fixtures", "synthetic", "phase2.json");
const seedPath = path.join(root, "supabase", "seed.sql");

const { buildSeedSql } = await import("./seed-sql.ts");
const sql = buildSeedSql(JSON.parse(readFileSync(fixturePath, "utf8")));

if (process.argv.includes("--check")) {
  // Git on Windows may check the file out with CRLF line endings; the content is what matters.
  const current = existsSync(seedPath) ? readFileSync(seedPath, "utf8").split("\r\n").join("\n") : "";
  if (current !== sql) {
    console.error("supabase/seed.sql is out of date. Run: npm run seed:build");
    process.exit(1);
  }
  console.log("supabase/seed.sql is up to date.");
} else {
  writeFileSync(seedPath, sql, "utf8");
  console.log(`Wrote ${path.relative(root, seedPath)} (${sql.split("\n").length} lines).`);
}
