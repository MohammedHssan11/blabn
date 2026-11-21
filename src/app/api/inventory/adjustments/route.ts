import { NextResponse, type NextRequest } from "next/server";
import { authorizeRequest, isSameOrigin } from "@/modules/access/guard";
import { recordAdjustment, validateAdjustment } from "@/modules/inventory/adjustments";

/**
 * Direct application request for an inventory adjustment (JSON body: branch, businessDate,
 * reason, note). Needs `inventory.adjust` for the branch named in the body; the database policy
 * checks the same permission again when the row is written.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const branch = typeof raw.branch === "string" ? raw.branch : "";

  // Authorize before looking at anything else in the body.
  const decision = await authorizeRequest(branch ? { permission: "inventory.adjust", branch } : []);
  if (!decision.ok) return decision.response;
  if (!branch) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const input = validateAdjustment({
    branch,
    businessDate: typeof raw.businessDate === "string" ? raw.businessDate : undefined,
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
    note: typeof raw.note === "string" ? raw.note : "",
  });
  if (!input) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await recordAdjustment(input);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "forbidden" ? 403 : result.error === "invalid_input" ? 400 : 503 });
  }
  return NextResponse.json({ id: result.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
