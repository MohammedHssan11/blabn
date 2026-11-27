import type { NextRequest } from "next/server";
import { authorizeRequest, isSameOrigin } from "@/modules/access/guard";
import { isIdentityDocument, isUuid } from "@/modules/attendance/forms";
import { readEmployee } from "@/modules/attendance/data";
import { checkFrames, enrollFace } from "@/modules/attendance/kiosk";
import { json, readJson } from "@/modules/attendance/routes";

/**
 * Face enrollment by an administrator holding attendance.enroll for the employee's branch, after
 * checking the person's identity document and recording their consent. The verifier builds and
 * encrypts the reference from these frames; the frames are dropped with the request.
 */
const MAX_BODY = 16 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const signedIn = await authorizeRequest();
  if (!signedIn.ok) return signedIn.response;
  if (!isSameOrigin(request)) return json({ error: "forbidden" }, 403);
  const body = await readJson(request, MAX_BODY);
  if (!body || !isUuid(body.employee)) return json({ error: "bad_request" }, 400);
  const employee = await readEmployee(String(body.employee).toLowerCase());
  if (!employee) return json({ error: "forbidden" }, 403);
  const decision = await authorizeRequest({ permission: "attendance.enroll", branch: employee.branchCode });
  if (!decision.ok) return decision.response;

  if (!isIdentityDocument(body.identity_document)) return json({ error: "identity_document_required" }, 400);
  if (body.consent !== true) return json({ error: "consent_required" }, 400);
  const frames = checkFrames(body.frames);
  if (!frames) return json({ error: "upload_invalid" }, 400);
  const outcome = await enrollFace(employee.id, frames, body.identity_document, true);
  return outcome.ok ? json(outcome) : json({ error: outcome.error }, outcome.status);
}
