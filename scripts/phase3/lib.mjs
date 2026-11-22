// Shared helpers for the Phase 3 HTTP end-to-end checks: a cookie jar, a form reader that
// submits the real server-action forms the way a browser without JavaScript does, a check
// reporter, and the local Supabase settings.
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadEnv() {
  const file = path.join(root, ".env.local");
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && env[m[1]] === undefined) env[m[1]] = m[2];
    }
  }
  return env;
}

export function createReporter() {
  const state = { checks: 0, failures: 0, names: [] };
  return {
    state,
    check(name, condition, detail = "") {
      state.checks += 1;
      if (condition) console.log(`  ok   ${name}`);
      else {
        state.failures += 1;
        state.names.push(name);
        console.log(`  FAIL ${name}${detail ? ` -> ${detail}` : ""}`);
      }
    },
    section(title) {
      console.log(`\n${title}`);
    },
  };
}

// ------------------------------------------------------------------ cookies

export class Jar {
  constructor() {
    this.cookies = new Map();
    this.raw = [];
  }
  apply(response) {
    for (const setCookie of response.headers.getSetCookie()) {
      this.raw.push(setCookie);
      const [pair] = setCookie.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const maxAge = /max-age=(-?\d+)/i.exec(setCookie);
      const expires = /expires=([^;]+)/i.exec(setCookie);
      const expired = (maxAge && Number(maxAge[1]) <= 0) || (expires && new Date(expires[1]) < new Date());
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  list() {
    return [...this.cookies].map(([name, value]) => ({ name, value }));
  }
  set(name, value) {
    this.cookies.set(name, value);
  }
  clone() {
    const copy = new Jar();
    copy.cookies = new Map(this.cookies);
    return copy;
  }
}

// ------------------------------------------------------------------ HTTP

export function makeHttp(base) {
  async function request(jar, method, pathname, { body, headers = {}, json } = {}) {
    const response = await fetch(new URL(pathname, base), {
      method,
      redirect: "manual",
      headers: {
        cookie: jar.header(),
        origin: base,
        "sec-fetch-dest": "document",
        accept: "text/html",
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : body,
    });
    jar.apply(response);
    return response;
  }
  /** Follows redirects (up to 6) and returns the final response with its text and the path chain. */
  async function follow(jar, response, chain = []) {
    let current = response;
    for (let i = 0; i < 6 && current.status >= 300 && current.status < 400; i += 1) {
      const location = new URL(current.headers.get("location"), base);
      chain.push(`${location.pathname}${location.search}`);
      current = await request(jar, "GET", `${location.pathname}${location.search}`);
    }
    return { response: current, chain, text: await current.text() };
  }
  const get = (jar, pathname, headers) => request(jar, "GET", pathname, { headers });
  return { request, follow, get };
}

const decode = (text) => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** Reads a server-rendered form (by its data-form name) the way a browser would submit it. */
export function readForm(html, name) {
  const match = new RegExp(`<form\\b[^>]*data-form="${name}"[^>]*>([\\s\\S]*?)</form>`).exec(html);
  if (!match) return null;
  const fields = [];
  for (const tag of match[1].match(/<(input|textarea)\b[^>]*>/g) ?? []) {
    const attr = (key) => {
      const m = new RegExp(`\\s${key}="([^"]*)"`).exec(tag);
      return m ? decode(m[1]) : null;
    };
    const fieldName = attr("name");
    if (!fieldName) continue;
    const type = (attr("type") ?? "text").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if (/\schecked(=|\s|\/|>)/.test(tag)) fields.push([fieldName, attr("value") ?? "on"]);
    } else if (type !== "submit" && type !== "button") {
      fields.push([fieldName, attr("value") ?? ""]);
    }
  }
  return fields;
}

/**
 * Submits a form. `set` replaces every existing value of a field name (arrays allowed for
 * multi-value fields such as checkboxes); fields not listed keep the value the page rendered.
 */
export async function submitForm(http, jar, pathname, html, formName, set = {}) {
  const fields = readForm(html, formName);
  if (!fields) throw new Error(`form ${formName} not found on ${pathname}`);
  const replaced = new Set(Object.keys(set));
  const body = new FormData();
  for (const [name, value] of fields) if (!replaced.has(name)) body.append(name, value);
  for (const [name, value] of Object.entries(set)) for (const v of Array.isArray(value) ? value : [value]) body.append(name, v);
  return http.request(jar, "POST", pathname, { body });
}

// ------------------------------------------------------------------ supabase

export function serviceClient(env) {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A Supabase client that carries the session stored in a cookie jar (so RLS applies as that person). */
export function clientFromJar(env, jar) {
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => jar.list(),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
}

/** Signs in with Supabase Auth directly (no web server) and returns the jar holding the session. */
export async function directSession(env, email, password) {
  const jar = new Jar();
  const client = clientFromJar(env, jar);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { jar, client };
}

// ------------------------------------------------------------------ processes

export function run(command, args, options = {}) {
  // npx is a .cmd file on Windows and needs a shell; node does not (and a shell would split quoted arguments).
  const viaShell = process.platform === "win32" && command === "npx";
  const result = spawnSync(viaShell ? "npx.cmd" : command === "node" ? process.execPath : command, args, {
    cwd: root,
    encoding: "utf8",
    shell: viaShell,
    ...options,
  });
  return result;
}

export function startServer(port, extraEnv = {}) {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: { ...loadEnv(), ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, log: () => log };
}

export async function waitUp(base, server) {
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch(`${base}/en/sign-in`, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server did not start:\n${server.log()}`);
}

export const plainText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

export async function mailFor(address, { subject = "", timeoutMs = 15000, mailpit = process.env.SUPABASE_TEST_MAILPIT_URL ?? "http://127.0.0.1:55324", after = 0 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = await (await fetch(`${mailpit}/api/v1/messages`)).json();
    const hit = (list.messages ?? [])
      .filter((m) => m.To?.some((t) => t.Address.toLowerCase() === address.toLowerCase()) && (m.Subject ?? "").includes(subject) && new Date(m.Created).getTime() >= after)
      .sort((a, b) => new Date(b.Created) - new Date(a.Created))[0];
    if (hit) return (await (await fetch(`${mailpit}/api/v1/message/${hit.ID}`)).json());
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no email for ${address}`);
}
