import type { NextRequest } from "next/server";
import { authorizeRequest, isSameOrigin } from "@/modules/access/guard";
import { isUuid } from "@/modules/attendance/forms";
import { checkFrames, failAttempt, verifyAndComplete } from "@/modules/attendance/kiosk";
import { authorizeKiosk, json, readJson } from "@/modules/attendance/routes";

/**
 * Kiosk: the frames captured while the employee performed this attempt's challenge. They are passed to
 * the verifier in memory and dropped with the request; nothing is written to disk or logged. The
 * browser's opinion of the result is never asked for. Sending the same request again after a success
 * returns the same event (the attempt completes once).
 */
const MAX_BODY = 16 * 1024 * 1024;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const signedIn = await authorizeRequest();
  if (!signedIn.ok) return signedIn.response;
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const kiosk = await authorizeKiosk();
  if (!kiosk.ok) return kiosk.response;
  const { id } = await context.params;
  if (!isUuid(id)) return json({ error: "attempt_not_found" }, 404);

  const body = await readJson(request, MAX_BODY);
  const frames = checkFrames(body?.frames);
  if (!frames) {
    const failed = await failAttempt(id.toLowerCase(), "upload_invalid");
    return failed.ok ? json(failed.view) : json({ error: failed.error }, failed.status);
  }
  const outcome = await verifyAndComplete(id.toLowerCase(), frames);
  return outcome.ok ? json(outcome.view) : json({ error: outcome.error }, outcome.status);
}
