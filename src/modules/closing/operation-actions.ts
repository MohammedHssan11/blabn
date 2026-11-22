"use server";

import { redirect } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/config";
import { isBusinessDate } from "@/lib/dates";
import { parseMadInput } from "@/lib/money";
import { createUserClient } from "@/lib/supabase/server";
import { OPERATING_BRANCH_CODE, type PermissionKey } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { DENOMINATIONS, type Command, type Change } from "./operations";

const draft = "daily_close.draft";
const manage = "daily_close.close";
const permission: Record<Exclude<Command, "count">, PermissionKey> = {
  save: draft, entry: draft, cancel_order: draft, submit: draft,
  reverse_entry: draft, reverse_cancellation: draft,
  close: manage, return: manage, late_remittance: manage, propose: manage, approve: manage, reject: manage,
};

type Input = Record<string, string | number | null | Record<string, number>>;

function buildPayload(command: Command, change: Change | null, form: FormData): Input | null {
  const value = (name: string) => String(form.get(name) ?? "").trim();
  const data: Input = {};
  let valid = true;
  const money = (name: string) => {
    const parsed = parseMadInput(value(name));
    if (parsed === undefined || (parsed !== null && parsed < 0)) valid = false;
    data[name] = parsed ?? null;
  };
  const integer = (name: string) => {
    const normalized = value(name).replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) & 15));
    if (!/^\d{0,10}$/.test(normalized)) valid = false;
    return normalized === "" ? null : Number(normalized);
  };

  if (change) Object.assign(data, { change, reason: value("reason") });
  switch (change ?? command) {
    case "save":
      for (const name of ["sales", "morning", "evening", "posCash", "card", "openingCash", "openingCustody"]) money(name);
      Object.assign(data, { cashier: value("cashier"), shift: value("shift"), notes: value("notes"), orders: integer("orders") });
      break;
    case "count": {
      const quantities: Record<string, number> = {};
      for (const denomination of DENOMINATIONS) {
        const quantity = integer(`qty${denomination}`);
        if (quantity !== null) quantities[denomination] = quantity;
      }
      Object.assign(data, { quantities, local: value("local"), counter: value("counter") });
      break;
    }
    case "entry":
    case "late_remittance":
      money("amount");
      for (const name of ["kind", "local", "account", "reference", "note"]) data[name] = value(name);
      break;
    case "cancel_order":
      money("originalAmount");
      money("replacementAmount");
      for (const name of ["original", "replacement", "originalLocal", "local", "note"]) data[name] = value(name);
      break;
    case "reverse_entry":
    case "reverse_cancellation":
      data.target = value("target");
      break;
  }
  return valid ? data : null;
}

export async function saveOperatingCommand(
  locale: Locale, screen: "daily-close" | "cash-count", date: string, revision: number,
  request: string, command: Command, change: Change | null, form: FormData,
) {
  if (!isLocale(locale) || !isBusinessDate(date)) throw new Error("Invalid daily close route.");
  const base = `/${locale}/${screen}?date=${date}`;
  const branch = OPERATING_BRANCH_CODE;
  const access = await requireAccess({
    locale,
    path: base,
    require: { permission: "daily_close.view", branch },
  });
  const required = command === "count"
    ? holds(access, manage, branch) ? manage : "cash_count.enter"
    : permission[command];
  await requireAccess({ locale, path: base, require: { permission: required, branch } });

  const payload = buildPayload(command, change, form);
  if (!payload) redirect(`${base}&error=invalid`);
  const client = await createUserClient();
  const result = await client.rpc("app_operating_command", {
    p_branch: branch, p_date: date, p_command: command, p_expected_revision: revision, p_request: request, p_payload: payload,
  });
  if (result.error) {
    const code = result.error.code;
    const error = code === "40001" ? "conflict" : code === "23505" ? "duplicate" : code === "42501" ? "denied"
      : code.startsWith("22") ? "invalid" : "unavailable";
    redirect(`${base}&error=${error}`);
  }
  redirect(`${base}&saved=1`);
}
export async function saveOperatingAccount(locale: Locale, date: string, id: string | null, form: FormData) {
  if (!isLocale(locale) || !isBusinessDate(date)) throw new Error("Invalid ledger account route.");
  const base = `/${locale}/daily-close?date=${date}`;
  await requireAccess({ locale, path: base, require: { permission: "admin.config.manage" } });
  const client = await createUserClient();
  const result = await client.rpc("app_set_operating_account", {
    p_branch: OPERATING_BRANCH_CODE, p_id: id, p_ledger: String(form.get("ledger") ?? ""),
    p_code: String(form.get("code") ?? ""), p_label: String(form.get("label") ?? ""), p_active: form.has("active"),
  });
  if (result.error) redirect(`${base}&error=${result.error.code === "23505" ? "duplicate" : "invalid"}#ledger-accounts`);
  redirect(`${base}&saved=1#ledger-accounts`);
}
