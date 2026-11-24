// Shared helpers for the Phase 10 rehearsal: the private reference data, synthetic people on the disposable
// stack, the daily-close commands the pages use, and report downloads. No real figure lives in this file; the
// real values are read from the private JSON files under outputs/phase10 (outside Git).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Jar, clientFromJar, loadEnv, run, serviceClient, submitForm } from "../phase3/lib.mjs";

export const secret = () => `${randomBytes(9).toString("base64url")}-Aa1`;
export const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
/** MAD amount (number or numeric string) to integer centimes without floating-point drift. */
export const cents = (mad) => Math.round(Number(mad) * 100);

/** Splits a MAD amount into the Maarif drawer denominations (centimes → quantity), largest first. */
export function denominations(mad) {
  let rest = cents(mad);
  const quantities = {};
  for (const face of [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1]) {
    quantities[face] = Math.floor(rest / face);
    rest -= quantities[face] * face;
  }
  if (rest !== 0) throw new Error(`cannot count ${mad}`);
  return quantities;
}

export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function context({ http, base, container }) {
  const env = loadEnv();
  const service = serviceClient(env);
  const where = (location) => (location ? new URL(location, base).pathname + new URL(location, base).search : "");
  const psql = (sql) => {
    const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX", "-v", "ON_ERROR_STOP=1"], { input: sql });
    if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  const get = async (jar, pathname) => {
    const response = await http.get(jar, pathname);
    return { status: response.status, location: response.headers.get("location"), html: await response.text() };
  };
  async function signIn(email, password) {
    const jar = new Jar();
    const page = await get(jar, "/en/sign-in");
    const response = await submitForm(http, jar, "/en/sign-in", page.html, "sign-in", { email, password });
    return { jar, status: response.status, db: clientFromJar(env, jar) };
  }
  async function makeStaff(name, assignments, employeeBranch = "maarif") {
    const email = `p10.${randomBytes(4).toString("hex")}@example.test`;
    const password = secret();
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`could not create ${name}`);
    const id = created.data.user.id;
    const rows = assignments.map(([branch, group]) => branch === null
      ? `insert into public.staff_group_assignments(staff_id, branch_id, group_key) values ('${id}', null, '${group}');`
      : `insert into public.branch_memberships(staff_id, branch_id) select '${id}', id from public.branches where code = '${branch}' on conflict do nothing;
         insert into public.staff_group_assignments(staff_id, branch_id, group_key) select '${id}', id, '${group}' from public.branches where code = '${branch}';`).join("\n");
    psql(`begin;
      insert into public.employees(id, organization_id, full_name) select '${id}', organization_id, '${name}' from public.branches where code = '${employeeBranch}';
      insert into public.staff_accounts(user_id, employee_id, organization_id, email) select id, id, organization_id, '${email}' from public.employees where id = '${id}';
      ${rows}
      commit;`);
    return { id, email, password, ...(await signIn(email, password)) };
  }
  /** One daily-close command exactly as the pages issue it (the same database function). */
  const op = async (db, date, command, expected, payload, request = crypto.randomUUID()) => {
    const { data, error } = await db.rpc("app_operating_command", { p_branch: "maarif", p_date: date, p_command: command, p_expected_revision: expected, p_request: request, p_payload: payload });
    if (error) throw Object.assign(new Error(`${command} ${date}: ${error.code} ${error.message}`), { code: error.code });
    return data;
  };
  return { env, service, where, psql, get, signIn, makeStaff, op };
}
