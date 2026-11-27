import "server-only";
import { NextResponse } from "next/server";
import { authorizeRequest } from "@/modules/access/guard";
import { readKioskContext } from "./data";

export const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * The kiosk's identity for a route handler: a signed-in staff session that the database recognises
 * as an active, registered, least-privilege device, holding attendance.event.create for the
 * device's branch. The database checks the same again inside every kiosk command.
 */
export async function authorizeKiosk(): Promise<{ ok: true; branch: string } | { ok: false; response: NextResponse }> {
  const context = await readKioskContext();
  if (context.state !== "ready" || !context.branchCode) {
    return { ok: false, response: json({ error: context.state === "unavailable" ? "unavailable" : context.state }, context.state === "unavailable" ? 503 : 403) };
  }
  const decision = await authorizeRequest({ permission: "attendance.event.create", branch: context.branchCode });
  if (!decision.ok) return decision;
  return { ok: true, branch: context.branchCode };
}

/**
 * Reads a JSON body of at most `limit` bytes; null when it is missing, too large or not JSON. The body
 * is streamed and abandoned as soon as it passes the limit, whether or not a length was declared.
 */
export async function readJson(request: Request, limit: number): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
