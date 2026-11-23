"use server";

import { redirect } from "next/navigation";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { localeField, textField } from "@/modules/access/forms";
import { requireAccess } from "@/modules/access/guard";
import { isCatalogId } from "@/modules/catalog/forms";
import { mapStockError, runStockCommand } from "./stock";
import { buildStockPayload, isStockCommand, isStockDate, safeInventoryPath, stockPermission } from "./stock-forms";

function withParam(path: string, name: string, value: string): string {
  const url = new URL(path, "http://site.invalid");
  url.searchParams.delete("error");
  url.searchParams.delete("notice");
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}`;
}

/**
 * The single form handler of the stock screens. It authorizes first with the permission the command
 * needs, then sends the command as the signed-in person. The request identifier is written into the
 * form when the page is rendered, so a resubmitted or retried form is the same request and the
 * database returns its first result instead of adding a second movement.
 */
export async function stockCommandAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const back = safeInventoryPath(locale, textField(data, "back"), `/${locale}/inventory`);
  const command = textField(data, "command");
  const date = textField(data, "date");
  const request = textField(data, "request");
  if (!isStockCommand(command)) redirect(withParam(back, "error", "invalid_input"));
  const permission = stockPermission(command, textField(data, "kind"));
  await requireAccess({ locale, path: back, require: { permission: permission ?? "inventory.view", branch: OPERATING_BRANCH_CODE } });
  if (!permission || !isStockDate(date) || !isCatalogId(request)) redirect(withParam(back, "error", "invalid_input"));
  const payload = buildStockPayload(command, (name) => textField(data, name));
  if (!payload) redirect(withParam(back, "error", "invalid_input"));

  const result = await runStockCommand(date, command, request.toLowerCase(), payload);
  if (result.error) redirect(withParam(back, "error", mapStockError(result.error.code)));
  redirect(withParam(back, "notice", (result.data as { replayed?: boolean } | null)?.replayed ? "stock_replayed" : "stock_saved"));
}
