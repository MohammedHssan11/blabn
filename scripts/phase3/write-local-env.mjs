// Writes .env.local for the LOCAL Supabase instance (`npx supabase start` must be running).
// The values are the local development keys the Supabase CLI prints for your own machine; the file
// is ignored by Git (.env.* is in .gitignore). Production values are never written by this script.
// Usage: node scripts/phase3/write-local-env.mjs [--force]
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = path.join(root, ".env.local");
if (existsSync(target) && !process.argv.includes("--force")) {
  console.log(".env.local already exists (use --force to replace it).");
  process.exit(0);
}

const run = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["supabase", "status", "-o", "env"], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (run.status !== 0) {
  console.error(`Could not read the local Supabase status. Is it running (npx supabase start)?\n${run.stderr}`);
  process.exit(1);
}
const values = Object.fromEntries(
  run.stdout
    .split(/\r?\n/)
    .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
for (const key of ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY"]) {
  if (!values[key]) {
    console.error(`The local Supabase status has no ${key}.`);
    process.exit(1);
  }
}
writeFileSync(
  target,
  [
    "# LOCAL development values only (written by scripts/phase3/write-local-env.mjs). Not committed.",
    `NEXT_PUBLIC_SUPABASE_URL=${values.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${values.PUBLISHABLE_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY=${values.SECRET_KEY}`,
    "SITE_URL=http://127.0.0.1:3000",
    "",
  ].join("\n"),
);
console.log("Wrote .env.local for the local Supabase instance.");
