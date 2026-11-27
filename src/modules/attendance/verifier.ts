import "server-only";

/**
 * Client of the isolated attendance verifier (services/attendance-verifier). Server-side only: the
 * bearer token never reaches a browser, and the verifier is reached on a private address.
 *
 * The web server passes frames through without keeping, logging or inspecting them, and returns the
 * verifier's signed verdict to the database unchanged. It cannot make a verdict itself: the database
 * checks the verifier's HMAC signature with a key this server does not hold.
 */

export interface VerifierVerdict {
  result: {
    outcome: "success" | "failure";
    reason?: string;
    engine: string;
    issued_at_ms: string;
    key_id: string;
    metrics?: Record<string, unknown>;
    quality?: Record<string, unknown>;
  };
  signature?: string;
  ciphertext?: string;
}

export type VerifierCall = { ok: true; verdict: VerifierVerdict } | { ok: false; reason: "verifier_unavailable" };

const TIMEOUT_MS = 20_000;

function settings(): { url: string; token: string } | null {
  const url = process.env.ATTENDANCE_VERIFIER_URL;
  const token = process.env.ATTENDANCE_VERIFIER_TOKEN;
  if (!url || !token || token.length < 32) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function verifierConfigured(): boolean {
  return settings() !== null;
}

async function call(path: "/v1/verify" | "/v1/enroll", body: unknown): Promise<VerifierCall> {
  const config = settings();
  if (!config) return { ok: false, reason: "verifier_unavailable" };
  try {
    const response = await fetch(`${config.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, reason: "verifier_unavailable" };
    const verdict = (await response.json()) as VerifierVerdict;
    if (!verdict?.result || (verdict.result.outcome !== "success" && verdict.result.outcome !== "failure")) {
      return { ok: false, reason: "verifier_unavailable" };
    }
    return { ok: true, verdict };
  } catch {
    return { ok: false, reason: "verifier_unavailable" };
  }
}

export function verifyAttempt(attempt: Record<string, unknown>, frames: string[]): Promise<VerifierCall> {
  return call("/v1/verify", { attempt, frames });
}

export function enrollEmployee(enrollment: { enrollment_id: string; nonce: string; employee_id: string }, frames: string[]): Promise<VerifierCall> {
  return call("/v1/enroll", { enrollment, frames });
}
