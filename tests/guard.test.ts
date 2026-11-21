import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessContext } from "@/modules/access/session";

/**
 * The authorization path with the session and the database mocked. The real database policies are
 * exercised by supabase/tests/phase3_checks.sql and scripts/phase3/e2e.mjs.
 */

let context: AccessContext = { state: "anonymous" };
const rpc = vi.fn();

vi.mock("@/modules/access/session", () => ({
  getAccessContext: async () => context,
}));
vi.mock("@/lib/supabase/server", () => ({
  createUserClient: async () => ({ rpc }),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new Error(`REDIRECT ${target}`);
  },
  forbidden: () => {
    throw new Error("FORBIDDEN");
  },
}));

const active = (overrides: Partial<Extract<AccessContext, { state: "active" }>> = {}): AccessContext => ({
  state: "active",
  userId: "u1",
  fullName: "Test",
  email: "t@example.test",
  mustChangePassword: false,
  permissions: [],
  ...overrides,
});

async function guard() {
  return import("@/modules/access/guard");
}

beforeEach(() => {
  rpc.mockReset();
  context = { state: "anonymous" };
});

describe("authorize", () => {
  it("denies an anonymous visitor without asking the database", async () => {
    const { authorize } = await guard();
    expect(await authorize({ permission: "daily_close.view", branch: "maarif" })).toEqual({ ok: false, reason: "unauthenticated" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["disabled", "unregistered"] as const)("ends the session of a %s account", async (state) => {
    context = { state };
    const { authorize } = await guard();
    expect(await authorize({ permission: "daily_close.view", branch: "maarif" })).toEqual({ ok: false, reason: "session_ended" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when the services do not answer", async () => {
    const { authorize } = await guard();
    context = { state: "unavailable" };
    expect(await authorize()).toEqual({ ok: false, reason: "unavailable" });
    context = active();
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    expect(await authorize({ permission: "daily_close.view", branch: "maarif" })).toEqual({ ok: false, reason: "unavailable" });
  });

  it("requires a password change before anything else", async () => {
    context = active({ mustChangePassword: true });
    const { authorize } = await guard();
    expect(await authorize({ permission: "daily_close.view", branch: "maarif" })).toEqual({ ok: false, reason: "password_change" });
    expect(await authorize()).toEqual({ ok: false, reason: "password_change" });
    expect((await authorize([], { allowPasswordChange: true })).ok).toBe(true);
  });

  it("asks the database for each requirement and never trusts the cached permission list", async () => {
    // The menu list says the person holds the permission; the database says no. The database wins.
    context = active({ permissions: [{ permission: "daily_close.view", branch: "maarif" }] });
    rpc.mockResolvedValue({ data: false, error: null });
    const { authorize } = await guard();
    expect(await authorize({ permission: "daily_close.view", branch: "maarif" })).toEqual({ ok: false, reason: "forbidden" });
    expect(rpc).toHaveBeenCalledWith("app_authorize", { p_permission: "daily_close.view", p_branch_code: "maarif" });
  });

  it("allows only when every requirement is granted", async () => {
    context = active();
    rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    const { authorize } = await guard();
    const requirements = [
      { permission: "comparison.view" as const, branch: "maarif" },
      { permission: "comparison.view" as const, branch: "alquds" },
    ];
    expect(await authorize(requirements)).toEqual({ ok: false, reason: "forbidden" });
    rpc.mockReset();
    rpc.mockResolvedValue({ data: true, error: null });
    const ok = await authorize(requirements);
    expect(ok.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("treats anything other than a literal true as a refusal", async () => {
    context = active();
    const { authorize } = await guard();
    for (const data of [null, undefined, "true", 1, {}]) {
      rpc.mockResolvedValueOnce({ data, error: null });
      expect((await authorize({ permission: "admin.users.manage" })).ok, JSON.stringify(data)).toBe(false);
    }
  });

  it("organization permissions are asked without a branch", async () => {
    context = active();
    rpc.mockResolvedValue({ data: true, error: null });
    const { authorize } = await guard();
    await authorize({ permission: "admin.users.manage" });
    expect(rpc).toHaveBeenCalledWith("app_authorize", { p_permission: "admin.users.manage", p_branch_code: null });
  });
});

describe("requireAccess (pages and server actions)", () => {
  const base = { locale: "en" as const, path: "/en/admin/staff" };

  it("sends an anonymous visitor to sign in and remembers the page", async () => {
    const { requireAccess } = await guard();
    await expect(requireAccess({ ...base, require: { permission: "admin.users.manage" } })).rejects.toThrow("REDIRECT /en/sign-in?next=%2Fen%2Fadmin%2Fstaff");
  });

  it("answers a refusal with 403 (forbidden)", async () => {
    context = active();
    rpc.mockResolvedValue({ data: false, error: null });
    const { requireAccess } = await guard();
    await expect(requireAccess({ ...base, require: { permission: "admin.users.manage" } })).rejects.toThrow("FORBIDDEN");
  });

  it("ends the session of a disabled person", async () => {
    context = { state: "disabled" };
    const { requireAccess } = await guard();
    await expect(requireAccess({ ...base, locale: "ar", require: { permission: "admin.users.manage" } })).rejects.toThrow("REDIRECT /api/auth/session-ended?locale=ar");
  });

  it("sends a person with a temporary password to choose their own", async () => {
    context = active({ mustChangePassword: true });
    const { requireAccess } = await guard();
    await expect(requireAccess(base)).rejects.toThrow("REDIRECT /en/account/password");
  });

  it("throws (denies) when authorization is unavailable", async () => {
    context = { state: "unavailable" };
    const { requireAccess } = await guard();
    await expect(requireAccess(base)).rejects.toThrow(/did not answer/);
  });

  it("returns the person when allowed", async () => {
    context = active({ fullName: "Abdo" });
    rpc.mockResolvedValue({ data: true, error: null });
    const { requireAccess } = await guard();
    const access = await requireAccess({ ...base, require: { permission: "admin.users.manage" } });
    expect(access.fullName).toBe("Abdo");
  });
});

describe("authorizeRequest (route handlers)", () => {
  it("answers with the right status code", async () => {
    const { authorizeRequest } = await guard();
    const status = async () => {
      const result = await authorizeRequest({ permission: "comparison.export", branch: "alquds" });
      return result.ok ? 200 : result.response.status;
    };
    context = { state: "anonymous" };
    expect(await status()).toBe(401);
    context = { state: "disabled" };
    expect(await status()).toBe(401);
    context = { state: "unavailable" };
    expect(await status()).toBe(503);
    context = active({ mustChangePassword: true });
    expect(await status()).toBe(403);
    context = active();
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await status()).toBe(403);
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await status()).toBe(200);
  });

  it("never caches a refusal", async () => {
    const { authorizeRequest } = await guard();
    const result = await authorizeRequest({ permission: "comparison.export", branch: "alquds" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("isSameOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the configured origin including scheme, and allows non-browser requests", async () => {
    vi.stubEnv("SITE_URL", "http://127.0.0.1:3000");
    const { isSameOrigin } = await guard();
    const request = (headers: Record<string, string>) => new Request("http://127.0.0.1:3000/api/x", { method: "POST", headers });
    expect(isSameOrigin(request({ origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(true);
    expect(isSameOrigin(request({ origin: "http://evil.example", host: "127.0.0.1:3000" }))).toBe(false);
    expect(isSameOrigin(request({ origin: "not a url", host: "127.0.0.1:3000" }))).toBe(false);
    expect(isSameOrigin(request({ origin: "https://127.0.0.1:3000", host: "127.0.0.1:3000" }))).toBe(false);
    expect(isSameOrigin(request({ origin: "http://other.example", "x-forwarded-host": "other.example" }))).toBe(false);
    expect(isSameOrigin(request({ host: "127.0.0.1:3000" }))).toBe(true);
  });
});
