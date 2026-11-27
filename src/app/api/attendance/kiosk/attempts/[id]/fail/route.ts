import type { NextRequest } from "next/server";
import { authorizeRequest, isSameOrigin } from "@/modules/access/guard";
import { isClientFailure, isUuid } from "@/modules/attendance/forms";
import { failAttempt } from "@/modules/attendance/kiosk";
import { authorizeKiosk, json, readJson } from "@/modules/attendance/routes";

/**
 * Kiosk: the attempt could not reach the verifier (camera refused or stopped, the employee cancelled,
 * the capture timed out). Recorded as a reviewable failure; it can never create an event.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const signedIn = await authorizeRequest();
  if (!signedIn.ok) return signedIn.response;
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const kiosk = await authorizeKiosk();
  if (!kiosk.ok) return kiosk.response;
  const { id } = await context.params;
  if (!isUuid(id)) return json({ error: "attempt_not_found" }, 404);
  const body = await readJson(request, 1_000);
  if (!body || !isClientFailure(body.reason)) return json({ error: "bad_request" }, 400);
  const outcome = await failAttempt(id.toLowerCase(), body.reason);
  return outcome.ok ? json(outcome.view) : json({ error: outcome.error }, outcome.status);
}
