import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const SRC = path.resolve(__dirname, "../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));

describe("server-side calculations", () => {
  it("client components never import calculation, repository or module code", async () => {
    const clients = files.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    expect(clients.length).toBeGreaterThan(0);
    for (const file of clients) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/from\s+["']@\/(modules|lib\/repository|lib\/fixtures|lib\/money)/);
    }
  });

  it("data-access services and the repository are marked server-only", async () => {
    for (const rel of ["lib/repository.ts", "modules/closing/service.ts", "modules/comparisons/service.ts"]) {
      expect(readFileSync(path.join(SRC, rel), "utf8"), rel).toMatch(/import\s+["']server-only["']/);
    }
  });

  it("view components do no arithmetic on money", async () => {
    for (const rel of ["components/values.tsx", "components/KvList.tsx"]) {
      const source = readFileSync(path.join(SRC, rel), "utf8");
      expect(source, rel).not.toMatch(/\bsumMinor|ratioBp|averageMinor|roundDiv|growthBp/);
    }
  });
});

describe("secrets", () => {
  it("never reads the service-role key in client-reachable code", async () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      if (/SUPABASE_SERVICE_ROLE_KEY/.test(source)) {
        expect(source, file).toMatch(/import\s+["']server-only["']/);
        expect(source, file).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE/);
      }
    }
  });
});

describe("language routing and persistence (proxy)", () => {
  const request = (url: string, headers: Record<string, string> = {}, cookie?: string) =>
    new NextRequest(`http://localhost${url}`, {
      headers: { ...headers, ...(cookie ? { cookie } : {}) },
    });
  const nav = { "sec-fetch-dest": "document" };

  it("sends a path without a language to Arabic the first time and saves it", async () => {
    const res = await proxy(request("/", nav));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/ar");
    expect(res.cookies.get("balaban-locale")?.value).toBe("ar");
  });

  it("sends a path without a language to the saved language", async () => {
    const res = await proxy(request("/daily-close?month=2026-11", nav, "balaban-locale=en"));
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/en/daily-close");
    expect(location.search).toBe("?month=2026-11");
  });

  it("saves the language when a page is opened in it", async () => {
    const res = await proxy(request("/en/cash-count", nav, "balaban-locale=ar"));
    expect(res.cookies.get("balaban-locale")?.value).toBe("en");
  });

  it("does not change the saved language on a background prefetch", async () => {
    const res = await proxy(request("/en/cash-count", { "next-router-prefetch": "1", rsc: "1" }, "balaban-locale=ar"));
    expect(res.cookies.get("balaban-locale")).toBeUndefined();
  });

  it("keeps the saved language when it already matches", async () => {
    const res = await proxy(request("/ar/reports", nav, "balaban-locale=ar"));
    expect(res.cookies.get("balaban-locale")).toBeUndefined();
  });

  it("ignores an invalid saved value", async () => {
    const res = await proxy(request("/", nav, "balaban-locale=xx"));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/ar");
  });
});
