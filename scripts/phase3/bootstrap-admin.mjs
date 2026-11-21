// Creates the FIRST System Admin of an organization (Abdo, in the deployed application).
//
//   node scripts/phase3/bootstrap-admin.mjs --email <address> --name "<full name>"
//        [--organization <uuid>] [--create-organization "<name>"] [--adopt-existing]
//        [--confirm-remote]
//
// What it does, once per environment:
//   1. Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or from
//      .env.local. The service-role key stays on the machine running this script.
//   2. Picks the organization: --organization, or the only one in the database. With
//      --create-organization it creates the organization and its three branches (Maarif as the
//      operating branch; Al Quds and Bourgogne as comparison-only) when none exists.
//   3. Creates the sign-in account in Supabase Auth. The password comes from the environment
//      variable BOOTSTRAP_ADMIN_PASSWORD or a hidden prompt, never from the command line, and is
//      never printed, logged or stored. It is a TEMPORARY password: the account is flagged so the
//      person must choose their own at the first sign-in.
//   4. Calls the database command app_bootstrap_system_admin (service role only), which creates the
//      employee and staff account, assigns the System Admin group and writes the audit record.
//      It refuses when the organization already has an active System Admin.
//
// It refuses to run against a non-local Supabase URL unless --confirm-remote is given. Production
// provisioning is a separate step that has not been done.
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv) {
  const args = { flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (["adopt-existing", "confirm-remote", "help"].includes(name)) args.flags.add(name);
    else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
      args[name] = value;
      i += 1;
    }
  }
  return args;
}

function loadEnvFile() {
  const file = path.join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("Set BOOTSTRAP_ADMIN_PASSWORD (no terminal to prompt on)."));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.includes(question)) process.stdout.write(text);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

function fail(message) {
  console.error(`Bootstrap failed: ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (args.flags.has("help")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 26).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
loadEnvFile();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) fail("set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment or .env.local).");
const local = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
if (!local && !args.flags.has("confirm-remote")) {
  fail(`${new URL(url).host} is not a local Supabase instance. Re-run with --confirm-remote only when you mean to provision it.`);
}

const email = (args.email ?? "").trim().toLowerCase();
const name = (args.name ?? "").trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("--email is required and must be an email address.");
if (!name) fail('--name "<full name>" is required.');

const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? (await promptHidden("Temporary password (at least 10 characters, hidden): "));
if (password.length < 10) fail("the temporary password must be at least 10 characters.");

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

// --- organization -------------------------------------------------------------------------
async function resolveOrganization() {
  if (args.organization) {
    const { data, error } = await supabase.from("organizations").select("id, name").eq("id", args.organization).maybeSingle();
    if (error || !data) fail(`organization ${args.organization} was not found.`);
    return data;
  }
  const { data, error } = await supabase.from("organizations").select("id, name");
  if (error) fail(`could not read organizations: ${error.message}`);
  if (data.length === 1) return data[0];
  if (data.length > 1) fail("several organizations exist; choose one with --organization <uuid>.");
  if (!args["create-organization"]) fail('no organization exists; add --create-organization "<name>" to create it with its three branches.');
  const created = await supabase.from("organizations").insert({ name: args["create-organization"] }).select("id, name").single();
  if (created.error) fail(`could not create the organization: ${created.error.message}`);
  const branches = await supabase.from("branches").insert([
    { organization_id: created.data.id, code: "maarif", name_en: "Maarif", name_ar: "المعاريف", operates_in_app: true },
    { organization_id: created.data.id, code: "alquds", name_en: "Al Quds", name_ar: "القدس", operates_in_app: false },
    { organization_id: created.data.id, code: "bourgogne", name_en: "Bourgogne", name_ar: "بورغوندي", operates_in_app: false },
  ]);
  if (branches.error) fail(`could not create the branches: ${branches.error.message}`);
  console.log(`Created organization "${created.data.name}" with branches maarif (operating), alquds and bourgogne (comparison only).`);
  return created.data;
}

const organization = await resolveOrganization();

// --- sign-in account ------------------------------------------------------------------------
let userId;
let createdHere = false;
const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error) {
  const exists = created.error.code === "email_exists" || created.error.code === "user_already_exists" || /already/i.test(created.error.message);
  if (!exists) fail(`could not create the sign-in account: ${created.error.message}`);
  if (!args.flags.has("adopt-existing")) fail(`${email} already has a sign-in account. Re-run with --adopt-existing to make it the System Admin (its password is set to the temporary one).`);
  let page = 1;
  for (;;) {
    const list = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (list.error) fail(`could not look up the existing account: ${list.error.message}`);
    const found = list.data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (found) {
      userId = found.id;
      break;
    }
    if (list.data.users.length < 200) fail("the existing account could not be found.");
    page += 1;
  }
  const updated = await supabase.auth.admin.updateUserById(userId, { password, email_confirm: true, ban_duration: "none" });
  if (updated.error) fail(`could not set the temporary password: ${updated.error.message}`);
} else {
  userId = created.data.user.id;
  createdHere = true;
}

// --- staff account, group and audit ---------------------------------------------------------
const result = await supabase.rpc("app_bootstrap_system_admin", {
  p_user_id: userId,
  p_organization_id: organization.id,
  p_full_name: name,
  p_email: email,
});
if (result.error) {
  if (createdHere) await supabase.auth.admin.deleteUser(userId);
  fail(result.error.message === "admin_exists" ? "this organization already has an active System Admin; add more from the staff screen." : result.error.message);
}

console.log(`System Admin ready: ${name} <${email}> (user ${userId}) in "${organization.name}".`);
console.log("The temporary password was not stored or printed. The person must choose their own password at the first sign-in.");
