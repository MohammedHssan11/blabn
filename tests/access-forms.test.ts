import { describe, expect, it } from "vitest";
import { checkNewPassword, looksLikeEmail, mapCommandError, MIN_PASSWORD_LENGTH, parseAccessForm, safeNextPath } from "@/modules/access/forms";

const BRANCHES = [
  { id: "id-maarif", code: "maarif" },
  { id: "id-alquds", code: "alquds" },
  { id: "id-bourgogne", code: "bourgogne" },
];

function form(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe("safeNextPath (where to return after sign-in)", () => {
  it("accepts a page of the same language", () => {
    expect(safeNextPath("en", "/en/admin/staff")).toBe("/en/admin/staff");
    expect(safeNextPath("ar", "/ar/daily-close?date=2026-11-02")).toBe("/ar/daily-close?date=2026-11-02");
  });
  it.each([
    "https://evil.example/en/x",
    "//evil.example/en/x",
    "/ar/daily-close",
    "/en",
    "/en/../ar/x",
    "/en/\\evil",
    "javascript:alert(1)",
    "/en/x\r\nSet-Cookie: a=b",
    "",
    null,
    undefined,
  ])("refuses %j", (value) => {
    expect(safeNextPath("en", value as string | null | undefined)).toBeNull();
  });
});

describe("passwords and emails", () => {
  it("checks length and confirmation", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(checkNewPassword("")).toBe("missing");
    expect(checkNewPassword("123456789")).toBe("too_short");
    expect(checkNewPassword("1234567890")).toBeNull();
    expect(checkNewPassword("1234567890", "1234567891")).toBe("mismatch");
    expect(checkNewPassword("1234567890", "1234567890")).toBeNull();
  });
  it("does not trim passwords (spaces count)", () => {
    expect(checkNewPassword("         a")).toBeNull();
  });
  it("recognizes plausible email addresses", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("a b@c.de")).toBe(false);
    expect(looksLikeEmail("no-at.example")).toBe(false);
  });
});

describe("parseAccessForm (the branch and group matrix)", () => {
  it("builds the access document the database command takes", () => {
    const access = parseAccessForm(
      form([
        ["group", "maarif:cashier"],
        ["group", "maarif:storekeeper"],
        ["group", "alquds:comparison_editor"],
        ["branch", "bourgogne"],
      ]),
      BRANCHES,
    );
    expect(access.organization_groups).toEqual([]);
    const byBranch = Object.fromEntries(access.branches.map((b) => [b.branch_id, b.groups]));
    expect(byBranch).toEqual({
      "id-maarif": ["cashier", "storekeeper"],
      "id-alquds": ["comparison_editor"],
      "id-bourgogne": [],
    });
  });

  it("choosing a group also makes the person a member of that branch", () => {
    const access = parseAccessForm(form([["group", "maarif:manager"]]), BRANCHES);
    expect(access.branches).toEqual([{ branch_id: "id-maarif", groups: ["manager"] }]);
  });

  it("reads organization groups and ignores unknown values", () => {
    const access = parseAccessForm(
      form([
        ["org_group", "system_admin"],
        ["org_group", "cashier"],
        ["org_group", "system_admin"],
        ["group", "nowhere:cashier"],
        ["group", "maarif:system_admin"],
        ["group", "maarif:cashier:extra"],
        ["group", "maarif"],
        ["branch", "nowhere"],
      ]),
      BRANCHES,
    );
    expect(access.organization_groups).toEqual(["system_admin"]);
    expect(access.branches).toEqual([]);
  });

  it("an empty form removes all access", () => {
    expect(parseAccessForm(form([]), BRANCHES)).toEqual({ organization_groups: [], branches: [] });
  });
});

describe("mapCommandError", () => {
  it("maps the database command errors to message codes", () => {
    expect(mapCommandError({ message: "permission_denied", code: "42501" })).toBe("forbidden");
    expect(mapCommandError({ message: "new row violates row-level security policy", code: "42501" })).toBe("forbidden");
    expect(mapCommandError({ message: "last_admin", code: "P0001" })).toBe("last_admin");
    expect(mapCommandError({ message: "self_disable", code: "P0001" })).toBe("self_disable");
    expect(mapCommandError({ message: "not_found", code: "P0002" })).toBe("not_found");
    expect(mapCommandError({ message: "invalid_input", code: "22023" })).toBe("invalid_input");
    expect(mapCommandError({ message: "duplicate", code: "23505", details: "Key (organization_id, employee_number)=(1) already exists." })).toBe("employee_number_in_use");
    expect(mapCommandError({ message: "duplicate", code: "23505", details: "Key (user_id)=(x) already exists." })).toBe("email_in_use");
    expect(mapCommandError({ message: "x", code: "23514" })).toBe("invalid_access");
    expect(mapCommandError({ message: "x", code: "23503" })).toBe("invalid_access");
    expect(mapCommandError({ message: "boom" })).toBe("unexpected");
    expect(mapCommandError(undefined)).toBe("unexpected");
  });
});
