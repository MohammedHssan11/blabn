import "server-only";
import { isBusinessDate } from "@/lib/dates";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Inventory adjustments, skeleton. Phase 6 adds products, units and quantities; Phase 3 provides
 * the permission-checked path (page, server action, route and database policy) so that "a cashier
 * cannot adjust inventory" is already enforced end to end before any stock data exists.
 *
 * The insert runs as the signed-in person, so the row-level policy `inventory_adjustments_insert`
 * is a second, independent check behind the application's `authorize`.
 */

export interface AdjustmentInput {
  branch: string;
  businessDate: string;
  reason: string;
  note: string;
}

export type AdjustmentResult =
  | { ok: true; id: string }
  | { ok: false; error: "invalid_input" | "forbidden" | "unavailable" };

export function validateAdjustment(input: Partial<AdjustmentInput>): AdjustmentInput | null {
  const branch = (input.branch ?? "").trim();
  const businessDate = (input.businessDate ?? "").trim();
  const reason = (input.reason ?? "").trim();
  const note = (input.note ?? "").trim();
  if (!branch || !isBusinessDate(businessDate) || reason.length === 0 || reason.length > 200 || note.length > 2000) return null;
  return { branch, businessDate, reason, note };
}

export async function recordAdjustment(input: AdjustmentInput): Promise<AdjustmentResult> {
  const supabase = await createUserClient();
  const { data: branch, error: branchError } = await supabase.from("branches").select("id").eq("code", input.branch).maybeSingle();
  if (branchError) return { ok: false, error: "unavailable" };
  // A branch the person cannot see is the same as no branch: denied.
  if (!branch) return { ok: false, error: "forbidden" };

  // The id is chosen here so the insert needs no read-back (entering and viewing are separate permissions).
  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("inventory_adjustments")
    .insert({ id, branch_id: (branch as { id: string }).id, business_date: input.businessDate, reason: input.reason, note: input.note });
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "unavailable" };
  return { ok: true, id };
}
