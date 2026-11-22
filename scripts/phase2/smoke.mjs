// HTTP-level smoke test of the PRODUCTION build: language routing and persistence, page direction,
// and the synthetic examples as rendered in both languages.
// Since Phase 3 every page needs a signed-in person, so this test creates a synthetic System Admin in the
// LOCAL Supabase database (random password, removed at the end) and sends its session with each request.
// Prerequisite: `npx supabase start` and `.env.local` (node scripts/phase3/write-local-env.mjs).
// Usage: npm run build && npm run test:smoke
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { directSession, loadEnv, serviceClient } from "../phase3/lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const port = process.env.SMOKE_PORT ?? "3199";
const base = `http://127.0.0.1:${port}`;
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

let failures = 0;
let checks = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

const server = spawn(process.execPath, [nextBin, "start", "-p", port, "-H", "127.0.0.1"], {
  cwd: root,
  env: { ...process.env, SITE_URL: base, BALABAN_DEMO_FIXTURES: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function waitUp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${base}/ar`, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${serverLog}`);
}

const NAV = { "sec-fetch-dest": "document", accept: "text/html" };
let authCookie = "";
const get = (p, headers = {}) => {
  const cookie = [headers.cookie, authCookie].filter(Boolean).join("; ");
  return fetch(`${base}${p}`, { redirect: "manual", headers: { ...NAV, ...headers, ...(cookie ? { cookie } : {}) } });
};

/** Creates a synthetic System Admin directly in the local database and returns its session cookies and a cleanup. */
async function signInSyntheticAdmin() {
  const env = loadEnv();
  const service = serviceClient(env);
  const email = `smoke.${randomBytes(4).toString("hex")}@example.test`;
  const password = `${randomBytes(9).toString("base64url")}-Aa1`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(`Cannot create the synthetic account (is local Supabase running?): ${created.error.message}`);
  const userId = created.data.user.id;
  const org = (await service.from("organizations").select("id").limit(1)).data?.[0]?.id;
  const employee = await service.from("employees").insert({ organization_id: org, full_name: "Smoke Admin" }).select("id").single();
  await service.from("staff_accounts").insert({ user_id: userId, employee_id: employee.data.id, organization_id: org, email });
  await service.from("staff_group_assignments").insert({ staff_id: userId, group_key: "system_admin" });
  const { jar } = await directSession(env, email, password);
  return {
    cookie: jar.header(),
    async cleanup() {
      await service.from("staff_group_assignments").delete().eq("staff_id", userId);
      await service.from("staff_accounts").delete().eq("user_id", userId);
      await service.from("employees").delete().eq("id", employee.data.id);
      await service.auth.admin.deleteUser(userId);
    },
  };
}
let cleanupAccount = async () => {};
const plain = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;| | /g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const setCookie = (res) => res.headers.getSetCookie().join(" | ");

try {
  await waitUp();
  const account = await signInSyntheticAdmin();
  authCookie = account.cookie;
  cleanupAccount = account.cleanup;

  console.log("Language routing and persistence");
  let res = await get("/");
  check("/ redirects to Arabic the first time", res.status === 307 && new URL(res.headers.get("location"), base).pathname === "/ar");
  check("first visit saves Arabic", /balaban-locale=ar/.test(setCookie(res)), setCookie(res));

  res = await get("/", { cookie: "balaban-locale=en" });
  check("/ goes to the saved language (en)", new URL(res.headers.get("location"), base).pathname === "/en");

  res = await get("/daily-close?month=2026-11", { cookie: "balaban-locale=en" });
  const loc = new URL(res.headers.get("location"), base);
  check("unprefixed deep link keeps path and query", loc.pathname === "/en/daily-close" && loc.search === "?month=2026-11", loc.href);

  res = await get("/en/cash-count", { cookie: "balaban-locale=ar" });
  check("opening a page in English saves English", /balaban-locale=en/.test(setCookie(res)), setCookie(res));
  res = await get("/en/cash-count", { cookie: "balaban-locale=ar", "next-router-prefetch": "1", rsc: "1", "sec-fetch-dest": "empty" });
  check("a background prefetch does not change the saved language", !/balaban-locale/.test(setCookie(res)), setCookie(res));

  console.log("Direction and language of each page");
  for (const [locale, dir] of [["ar", "rtl"], ["en", "ltr"]]) {
    for (const p of ["", "/daily-close", "/cash-count", "/comparison", "/reports"]) {
      res = await get(`/${locale}${p}`, { cookie: `balaban-locale=${locale}` });
      const html = await res.text();
      check(`/${locale}${p} -> 200, <html lang="${locale}" dir="${dir}">`, res.status === 200 && html.includes(`<html lang="${locale}" dir="${dir}">`));
    }
  }
  res = await get("/fr/daily-close", { cookie: "balaban-locale=ar" });
  check("an unknown language is not served as a page", res.status !== 200, String(res.status));

  console.log("Language switch keeps the page and the query");
  for (const [from, to, label] of [["ar", "en", "English"], ["en", "ar", "العربية"]]) {
    res = await get(`/${from}/cash-count?date=2026-11-02&counted=603`, { cookie: `balaban-locale=${from}` });
    const html = await res.text();
    const m = new RegExp(`<a[^>]*data-switch-to="${to}"[^>]*>`).exec(html);
    check(`${from}: switch link targets ${to}`, Boolean(m), "link not found");
    check(`${from}: switch link keeps page and query`, Boolean(m) && m[0].includes(`href="/${to}/cash-count?date=2026-11-02&amp;counted=603"`), m?.[0]);
    check(`${from}: switch label is "${label}"`, html.includes(`>${label}</a>`));
  }

  console.log("Cash count example (synthetic)");
  for (const locale of ["en", "ar"]) {
    res = await get(`/${locale}/cash-count?date=2026-11-02`, { cookie: `balaban-locale=${locale}` });
    const html = await res.text();
    const text = plain(html);
    check(`${locale}: counted 603.00`, /603\.00/.test(text));
    check(`${locale}: expected 600.00`, /600\.00/.test(text));
    check(`${locale}: variance +3.00 shown`, /\+\s?(MAD\s)?3\.00/.test(text) || /3\.00\s?د\.م\.\s?‏?/.test(text));
    check(`${locale}: stored variance renders twice (at count and after the later deposit)`, (html.match(/data-field="ST-08"/g) ?? []).length >= 3);
    check(`${locale}: later deposit 500.00 listed after the count`, /data-section="after-count"[\s\S]*?500\.00/.test(html));
    check(`${locale}: drawer after later movements 103.00`, /103\.00/.test(text));
    check(`${locale}: counter/cashier fields marked pending for Phase 4`, html.includes('data-pending-field="ST-09"') && html.includes('data-pending-field="LG-08"'));
  }
  res = await get("/en/cash-count?date=2026-11-02&counted=", { cookie: "balaban-locale=en" });
  let html = await res.text();
  check("empty preview is 'not counted' (never a match)", html.includes('data-status="not_counted"') && !/data-section="preview-result"[\s\S]*data-status="match"/.test(html));
  res = await get("/en/cash-count?date=2026-11-02&counted=0", { cookie: "balaban-locale=en" });
  html = await res.text();
  check("preview of 0 is a real count (short by 600.00)", /data-section="preview-result"[\s\S]*data-status="short"/.test(html));
  res = await get("/en/cash-count?date=2026-11-02&counted=abc", { cookie: "balaban-locale=en" });
  html = await res.text();
  check("invalid amount shows the validation message", html.includes('role="alert"') && html.includes("Enter a valid amount in MAD"));
  res = await get("/ar/cash-count?date=2026-11-02&counted=abc", { cookie: "balaban-locale=ar" });
  html = await res.text();
  check("validation message is Arabic in Arabic", html.includes("أدخل مبلغًا صحيحًا"));

  console.log("Oversized preview amounts (numeric(14,2) range)");
  const oversized = [
    ["one cent above the maximum", "1000000000000.00"],
    ["one dirham above, Arabic digits", encodeURIComponent("١٠٠٠٠٠٠٠٠٠٠٠٠٫٠٠")],
    ["400 digits (overflows a JavaScript number)", "9".repeat(400)],
  ];
  for (const [locale, message] of [["en", "Enter a valid amount in MAD"], ["ar", "أدخل مبلغًا صحيحًا"]]) {
    for (const [label, typed] of oversized) {
      res = await get(`/${locale}/cash-count?date=2026-11-02&counted=${typed}`, { cookie: `balaban-locale=${locale}` });
      html = await res.text();
      check(`${locale}: ${label} -> 200 with the validation message`, res.status === 200 && html.includes('role="alert"') && html.includes(message), String(res.status));
      check(`${locale}: ${label} -> no calculated result`, !html.includes('data-section="preview-result"'));
    }
    res = await get(`/${locale}/cash-count?date=2026-11-02&counted=999999999999.99`, { cookie: `balaban-locale=${locale}` });
    html = await res.text();
    check(`${locale}: the maximum amount 999999999999.99 is still calculated`, html.includes('data-status="over"') && !html.includes('role="alert"'));
  }

  console.log("Daily close example (synthetic)");
  for (const locale of ["en", "ar"]) {
    res = await get(`/${locale}/daily-close?month=2026-11&date=2026-11-02`, { cookie: `balaban-locale=${locale}` });
    html = await res.text();
    const row = /<tr[^>]*data-date="2026-11-02"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? "";
    check(`${locale}: 2 Nov average order is 100.00`, /data-field="DS-04"[^>]*>[^<]*100\.00/.test(row), plain(row));
    const open = /<tr[^>]*data-date="2026-11-08"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? "";
    check(`${locale}: unclosed day shows blanks, not zeros`, (open.match(/data-blank="true"/g) ?? []).length >= 8 && !/0\.00/.test(open));
    const six = /<tr[^>]*data-date="2026-11-06"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? "";
    check(`${locale}: missing order count leaves the average blank`, /data-field="DS-04"[^>]*data-blank="true"|data-blank="true"[^>]*data-field="DS-04"/.test(six));
  }

  console.log("Weekly comparison example (synthetic)");
  for (const locale of ["en", "ar"]) {
    res = await get(`/${locale}/comparison`, { cookie: `balaban-locale=${locale}` });
    html = await res.text();
    const maarif = /<tr[^>]*data-branch="maarif"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? "";
    check(`${locale}: Maarif 120 vs 100 shows 120%`, /120[\s‎‏]*[%٪]/.test(plain(maarif)), plain(maarif));
    const bg = /<tr[^>]*data-branch="bourgogne"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? "";
    check(`${locale}: Bourgogne's missing figure is marked, not 0`, bg.includes('data-missing="true"'));
    check(`${locale}: incomplete total is flagged with coverage`, html.includes('data-completeness="incomplete"') && /2[^<]*3/.test(plain(/<tr[^>]*data-row="total"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? "")));
  }

  console.log("Report map");
  res = await get("/en/reports", { cookie: "balaban-locale=en" });
  html = await res.text();
  check("report map lists 54 fields", (html.match(/data-field-row="/g) ?? []).length === 54);
  check("pending fields are marked", (html.match(/data-pending="true"/g) ?? []).length === 6);
} catch (error) {
  failures += 1;
  console.error(error);
} finally {
  server.kill();
  await cleanupAccount().catch((error) => console.error(`cleanup failed: ${error.message}`));
}

console.log(`\n${checks - failures}/${checks} smoke checks passed.`);
process.exit(failures === 0 ? 0 : 1);
