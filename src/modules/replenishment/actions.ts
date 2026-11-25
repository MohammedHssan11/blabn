"use server";

import { redirect } from "next/navigation";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { localeField, textField } from "@/modules/access/forms";
import { requireAccess } from "@/modules/access/guard";
import { isCatalogId, normalizeQuantityInput } from "@/modules/catalog/forms";
import { runPurchaseOrderCommand, saveBranchSettings, saveItemSettings, saveSourceSettings } from "./data";
import { buildCommandPayload, isPurchaseOrderCommand, mapPurchaseOrderError, normalizeSafetyPercent, purchaseOrderPermission, safeReplenishmentPath } from "./forms";

function withParam(path: string, name: string, value: string): string {
  const url = new URL(path, "http://site.invalid");
  url.searchParams.delete("error");
  url.searchParams.delete("notice");
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}`;
}

/**
 * The single form handler of the purchase-order screens. It authorizes first with the permission the
 * command needs (creating, approving and receiving are separate), then sends the command as the
 * signed-in person. The request identifier is written into the form when the page is rendered, so a
 * resubmitted or retried form is the same request: the database returns its first result and
 * writes nothing new.
 */
export async function purchaseOrderAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const back = safeReplenishmentPath(locale, textField(data, "back"), `/${locale}/replenishment/orders`);
  const command = textField(data, "command");
  if (!isPurchaseOrderCommand(command)) redirect(withParam(back, "error", "invalid_input"));
  await requireAccess({ locale, path: back, require: { permission: purchaseOrderPermission(command), branch: OPERATING_BRANCH_CODE } });
  const request = textField(data, "request");
  const payload = buildCommandPayload(command, (name) => textField(data, name));
  if (!isCatalogId(request) || !payload) redirect(withParam(back, "error", "invalid_input"));

  const result = await runPurchaseOrderCommand(command, request.toLowerCase(), payload);
  if (result.error) redirect(withParam(back, "error", mapPurchaseOrderError(result.error.code)));
  const out = (result.data ?? {}) as { replayed?: boolean; order?: string };
  const next = command === "create" && out.order ? `/${locale}/replenishment/orders/${out.order}` : back;
  redirect(withParam(next, "notice", out.replayed ? "po_replayed" : `po_${command}`));
}

const intOrNull = (raw: string, min: number, max: number): number | null | undefined => {
  if (raw === "") return null;
  if (!/^\d{1,4}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n >= min && n <= max ? n : undefined;
};

/** Minimum number of complete observations, days covered by one delivery and the safety-stock percentage (System Admin). */
export async function saveBranchSettingsAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const back = `/${locale}/replenishment/settings`;
  await requireAccess({ locale, path: back, require: { permission: "admin.config.manage" } });
  const expected = intOrNull(textField(data, "revision"), 0, 9999);
  const min = intOrNull(textField(data, "min_observations"), 1, 13);
  const coverage = intOrNull(textField(data, "coverage_days"), 1, 14);
  const safetyPercent = normalizeSafetyPercent(textField(data, "safety_percent"));
  if (expected === undefined || expected === null || min === undefined || coverage === undefined || coverage === null || safetyPercent === null) {
    redirect(withParam(back, "error", "invalid_input"));
  }
  const { error } = await saveBranchSettings(expected, min, coverage, safetyPercent);
  if (error) redirect(withParam(back, "error", mapPurchaseOrderError(error.code)));
  redirect(withParam(back, "notice", "po_settings_saved"));
}

/** Pack size, supplier minimum, shelf life and source of one item (System Admin). Blank = not confirmed. Safety stock is the branch percentage. */
export async function saveItemSettingsAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const back = safeReplenishmentPath(locale, textField(data, "back"), `/${locale}/replenishment/settings`);
  await requireAccess({ locale, path: back, require: { permission: "admin.config.manage" } });
  const item = textField(data, "item");
  const expected = intOrNull(textField(data, "revision"), 0, 99999);
  const shelfLife = intOrNull(textField(data, "shelf_life_days"), 1, 3650);
  const source = textField(data, "source") || null;
  const qty = (name: string, allowZero: boolean): string | null | undefined => {
    const raw = textField(data, name).trim();
    if (raw === "") return null;
    if (allowZero && /^0+([.,٫]0+)?$/.test(raw)) return "0";
    const text = normalizeQuantityInput(raw);
    return text !== null && /^\d{1,12}(\.\d{1,6})?$/.test(text) ? text : undefined;
  };
  const pack = qty("pack", false);
  const minOrder = qty("min_order", false);
  if (!isCatalogId(item) || expected === undefined || expected === null || shelfLife === undefined || pack === undefined
    || minOrder === undefined || (source !== null && source !== "factory" && source !== "store")) {
    redirect(withParam(back, "error", "invalid_input"));
  }
  const { error } = await saveItemSettings(item.toLowerCase(), expected, { pack, minOrder, shelfLife, source });
  if (error) redirect(withParam(back, "error", mapPurchaseOrderError(error.code)));
  redirect(withParam(back, "notice", "po_settings_saved"));
}

/** Lead-time exception and order cut-off of a source (System Admin). Blank = the approved two-day rule / no cut-off. */
export async function saveSourceSettingsAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const back = `/${locale}/replenishment/settings`;
  await requireAccess({ locale, path: back, require: { permission: "admin.config.manage" } });
  const source = textField(data, "source");
  const expected = intOrNull(textField(data, "revision"), 0, 9999);
  const lead = intOrNull(textField(data, "lead_days"), 0, 14);
  const cutoff = textField(data, "cutoff") || null;
  if ((source !== "factory" && source !== "store") || expected === undefined || expected === null || lead === undefined
    || (cutoff !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff))) {
    redirect(withParam(back, "error", "invalid_input"));
  }
  const { error } = await saveSourceSettings(source, expected, lead, cutoff);
  if (error) redirect(withParam(back, "error", mapPurchaseOrderError(error.code)));
  redirect(withParam(back, "notice", "po_settings_saved"));
}
