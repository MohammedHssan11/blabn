// Runs one or more SQL check files against the LOCAL Supabase database.
// Usage: node scripts/phase3/db-check.mjs phase3_checks.sql [more files in supabase/tests]
// Prerequisites: Docker running and `npx supabase start` done.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectId = (/project_id\s*=\s*"([^"]+)"/.exec(readFileSync(path.join(root, "supabase", "config.toml"), "utf8")) ?? [])[1];
export const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;

export function runSqlFile(file) {
  const sql = readFileSync(path.join(root, "supabase", "tests", file), "utf8");
  const run = spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A"],
    { input: sql, encoding: "utf8" },
  );
  if (run.error) throw new Error(`Could not run docker: ${run.error.message}`);
  // Keep the last meaningful line (the "... passed" result); void results print blank lines or "t".
  const out = (run.stdout ?? "").split("\n").filter((l) => l.trim() !== "" && l.trim() !== "t").pop() ?? "";
  if (run.status !== 0) {
    throw new Error(`${file} FAILED (container ${container})\n${run.stderr ?? ""}`);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: node scripts/phase3/db-check.mjs <file.sql> [...]  (files live in supabase/tests)");
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    try {
      console.log(`${runSqlFile(file)}  [${file}]`);
    } catch (error) {
      failed = true;
      console.error(String(error.message));
    }
  }
  process.exit(failed ? 1 : 0);
}
