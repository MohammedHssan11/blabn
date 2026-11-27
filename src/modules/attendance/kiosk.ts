import "server-only";
import { createUserClient } from "@/lib/supabase/server";
import type { AttendanceAction, ClientFailure, IdentityDocument } from "./forms";
import { enrollEmployee, verifyAttempt } from "./verifier";

/**
 * The kiosk and enrollment flows on the server. Each step runs as the signed-in kiosk (or
 * administrator) session, so the database checks the device, branch, employee and permission on
 * every call. The browser only supplies the employee ID, the intended action and camera frames; the
 * decision comes from the verifier's signed verdict, which the database checks.
 */

export interface AttemptView {
  attempt_id?: string;
  status: string;
  reason?: string;
  action?: AttendanceAction;
  challenge?: string[];
  expires_in_ms?: number;
  employee_first_name?: string;
  event?: { kind: AttendanceAction; occurred_at: string; local: string };
  current_state?: { kind: AttendanceAction; local: string };
  replayed?: boolean;
}

export type KioskOutcome = { ok: true; view: AttemptView } | { ok: false; error: string; status: number };

function denied(message: string | undefined): KioskOutcome {
  // Device problems are refused by the database with the reason as the message.
  const device = ["not_a_device", "device_inactive", "account_inactive", "not_authorized", "device_overprivileged", "not_signed_in"];
  if (message && device.includes(message)) return { ok: false, error: message, status: 403 };
  if (message === "attempt_not_found") return { ok: false, error: "attempt_not_found", status: 404 };
  return { ok: false, error: "unavailable", status: 503 };
}

export async function startAttempt(request: string, code: string, action: AttendanceAction): Promise<KioskOutcome> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_attendance_attempt_start", { p_request: request, p_employee_code: code, p_action: action });
  if (error || !data) return denied(error?.message);
  return { ok: true, view: data as AttemptView };
}

export const MIN_FRAMES = 8;
export const MAX_FRAMES = 40;
const MAX_FRAME_CHARS = 600_000;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function checkFrames(frames: unknown): string[] | null {
  if (!Array.isArray(frames) || frames.length < MIN_FRAMES || frames.length > MAX_FRAMES) return null;
  for (const frame of frames) {
    if (typeof frame !== "string" || frame.length === 0 || frame.length > MAX_FRAME_CHARS || !BASE64.test(frame)) return null;
  }
  return frames as string[];
}

/** The stored state of the kiosk's own attempt (a retry after success answers with the same event). */
export async function attemptStatus(attempt: string): Promise<KioskOutcome> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_attendance_attempt_status", { p_attempt: attempt });
  if (error || !data) return denied(error?.message);
  return { ok: true, view: data as AttemptView };
}

export async function failAttempt(
  attempt: string,
  reason: ClientFailure | "verifier_unavailable" | "upload_invalid" | "reference_unavailable",
): Promise<KioskOutcome> {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_attendance_attempt_fail", { p_attempt: attempt, p_reason: reason });
  if (error || !data) return denied(error?.message);
  return { ok: true, view: data as AttemptView };
}

/** Sends this attempt's frames to the verifier and hands its signed verdict to the database. */
export async function verifyAndComplete(attempt: string, frames: string[]): Promise<KioskOutcome> {
  const db = await createUserClient();
  const { data: material, error } = await db.rpc("app_attendance_attempt_material", { p_attempt: attempt });
  if (error || !material) return denied(error?.message);
  const m = material as Record<string, unknown>;
  if (m.state === "reference_unavailable") return failAttempt(attempt, "reference_unavailable");
  if (m.state !== "pending") return attemptStatus(attempt);
  const call = await verifyAttempt(
    {
      attempt_id: m.attempt_id, nonce: m.nonce, employee_id: m.employee_id, reference_id: m.reference_id,
      action: m.action, challenge: m.challenge, ciphertext: m.ciphertext,
    },
    frames,
  );
  if (!call.ok) return failAttempt(attempt, call.reason);
  const { data: view, error: completeError } = await db.rpc("app_attendance_attempt_complete", {
    p_attempt: attempt, p_result: call.verdict.result, p_signature: call.verdict.signature ?? "",
  });
  if (completeError || !view) return denied(completeError?.message);
  return { ok: true, view: view as AttemptView };
}

export type EnrollOutcome =
  | { ok: true; status: "completed"; replaced: boolean }
  | { ok: true; status: "failed"; reason: string; quality?: Record<string, unknown> }
  | { ok: false; error: string; status: number };

/** One request: open an enrollment session, let the verifier build and encrypt the reference, store it. */
export async function enrollFace(employee: string, frames: string[], document: IdentityDocument, consent: boolean): Promise<EnrollOutcome> {
  const db = await createUserClient();
  const { data: session, error } = await db.rpc("app_attendance_enrollment_start", { p_employee: employee });
  if (error || !session) {
    const message = error?.message ?? "";
    if (message === "permission_denied" || message === "employee_not_found") return { ok: false, error: "forbidden", status: 403 };
    if (message === "employee_inactive") return { ok: false, error: "employee_inactive", status: 409 };
    return { ok: false, error: "unavailable", status: 503 };
  }
  const s = session as { enrollment_id: string; nonce: string; employee_id: string };
  const call = await enrollEmployee({ enrollment_id: s.enrollment_id, nonce: s.nonce, employee_id: s.employee_id }, frames);
  const fail = async (reason: string) => {
    await db.rpc("app_attendance_enrollment_fail", { p_enrollment: s.enrollment_id, p_reason: reason });
  };
  if (!call.ok) {
    await fail(call.reason);
    return { ok: true, status: "failed", reason: call.reason };
  }
  const verdict = call.verdict;
  if (verdict.result.outcome !== "success" || !verdict.ciphertext || !verdict.signature) {
    const reason = verdict.result.reason ?? "poor_quality";
    await fail(reason);
    return { ok: true, status: "failed", reason, quality: verdict.result.quality };
  }
  const { data: done, error: completeError } = await db.rpc("app_attendance_enrollment_complete", {
    p_enrollment: s.enrollment_id,
    p_ciphertext: verdict.ciphertext,
    p_result: verdict.result,
    p_signature: verdict.signature,
    p_identity_document: document,
    p_consent: consent,
  });
  if (completeError || !done) {
    const message = completeError?.message ?? "";
    if (message === "consent_required" || message === "identity_document_required") return { ok: false, error: message, status: 400 };
    return { ok: false, error: "unavailable", status: 503 };
  }
  const result = done as { status: string; reason?: string; replaced?: string | null };
  if (result.status !== "completed") return { ok: true, status: "failed", reason: result.reason ?? "failed" };
  return { ok: true, status: "completed", replaced: Boolean(result.replaced) };
}
