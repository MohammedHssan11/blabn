import type { NextRequest } from "next/server";
import { authorizeRequest, isSameOrigin } from "@/modules/access/guard";
import { isAction, isUuid, normaliseEmployeeCode } from "@/modules/attendance/forms";
import { startAttempt } from "@/modules/attendance/kiosk";
import { authorizeKiosk, json, readJson } from "@/modules/attendance/routes";

/**
 * Kiosk: an employee typed their ID and pressed Check in or Check out. The request key comes from the
 * page for that press, so a double tap or a network retry is the same attempt. The answer carries
 * the random challenge, or the reason the attempt was refused (recorded for review either way).
 */
export async function POST(request: NextRequest) {
  const signedIn = await authorizeRequest();
  if (!signedIn.ok) return signedIn.response;
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const kiosk = await authorizeKiosk();
  if (!kiosk.ok) return kiosk.response;

  const body = await readJson(request, 2_000);
  const code = normaliseEmployeeCode(body?.code);
  if (!body || !isUuid(body.request) || !isAction(body.action) || !code) return json({ error: "bad_request" }, 400);
  const outcome = await startAttempt(String(body.request).toLowerCase(), code, body.action);
  return outcome.ok ? json(outcome.view) : json({ error: outcome.error }, outcome.status);
}
