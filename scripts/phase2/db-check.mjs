// Runs supabase/tests/phase2_checks.sql against the LOCAL Supabase development database.
// Prerequisites: Docker running and `npx supabase start` (or `npx supabase db reset`) done.
// Usage: npm run db:check
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectId = (/project_id\s*=\s*"([^"]+)"/.exec(readFileSync(path.join(root, "supabase", "config.toml"), "utf8")) ?? [])[1];
const container = process.env.SUPABASE_DB_CONTAINER ?? `supabase_db_${projectId}`;
const sql = readFileSync(path.join(root, "supabase", "tests", "phase2_checks.sql"), "utf8");

const run = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A"],
  { input: sql, encoding: "utf8" },
);

if (run.error) {
  console.error(`Could not run docker: ${run.error.message}`);
  process.exit(2);
}
process.stdout.write(run.stdout ?? "");
if (run.status !== 0) {
  process.stderr.write(run.stderr ?? "");
  console.error(`Database checks FAILED (container ${container}).`);
  process.exit(1);
}
console.log(`Database checks passed (container ${container}).`);
