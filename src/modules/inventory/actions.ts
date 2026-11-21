"use server";

import { redirect } from "next/navigation";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { localeField, textField } from "@/modules/access/forms";
import { requireAccess } from "@/modules/access/guard";
import { recordAdjustment, validateAdjustment } from "./adjustments";

/** Form behind /inventory/adjustments. Authorizes first, then writes as the signed-in person. */
export async function recordAdjustmentAction(data: FormData): Promise<void> {
  const locale = localeField(data);
  const page = `/${locale}/inventory/adjustments`;
  const branch = textField(data, "branch") || OPERATING_BRANCH_CODE;
  await requireAccess({ locale, path: page, require: { permission: "inventory.adjust", branch } });

  const input = validateAdjustment({
    branch,
    businessDate: textField(data, "business_date"),
    reason: textField(data, "reason"),
    note: textField(data, "note"),
  });
  if (!input) redirect(`${page}?error=invalid_input`);

  const result = await recordAdjustment(input);
  if (!result.ok) redirect(`${page}?error=${result.error}`);
  redirect(`${page}?notice=adjustment_saved`);
}
