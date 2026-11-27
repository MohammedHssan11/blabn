import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getMessages } from "@/i18n/dictionary";
import {
  attendanceErrorCode,
  ATTENDANCE_ERRORS,
  CLIENT_FAILURES,
  isClientFailure,
  KIOSK_REASONS,
  kioskReason,
  normaliseEmployeeCode,
  parseCorrection,
  parseLocalDateTime,
  parsePeriod,
} from "@/modules/attendance/forms";
import { checkFrames } from "@/modules/attendance/kiosk";

const migration = readFileSync(path.resolve(__dirname, "../supabase/migrations/20261129090000_attendance.sql"), "utf8");
const uuid = "0b5f4c8e-1b2a-4c3d-9e8f-123456789abc";

describe("attendance form helpers", () => {
  it("defaults the period to the current month and refuses nonsense", () => {
    expect(parsePeriod(undefined, undefined, "2026-11-26")).toEqual({ from: "2026-11-01", to: "2026-11-26" });
    expect(parsePeriod("2026-11-10", "2026-11-09", "2026-11-26")).toBeNull();
    expect(parsePeriod("2025-01-01", "2026-11-26", "2026-11-26")).toBeNull();
    expect(parsePeriod("2026-02-30", "2026-03-01", "2026-11-26")).toBeNull();
  });

  it("reads branch-local date-times exactly as typed", () => {
    expect(parseLocalDateTime("2026-11-02T17:10")).toBe("2026-11-02 17:10:00");
    expect(parseLocalDateTime("2026-11-02T24:00")).toBeNull();
    expect(parseLocalDateTime("2026-11-02 17:10")).toBeNull();
    expect(parseLocalDateTime("17:10")).toBeNull();
  });

  it("validates corrections before they reach the database", () => {
    const base = { employee: uuid, target: uuid, eventKind: "check_out", local: "2026-11-02T17:10", reason: "Forgot to check out" };
    expect(parseCorrection({ ...base, kind: "retime" })).toMatchObject({ ok: true, value: { kind: "retime", target: uuid, local: "2026-11-02 17:10:00" } });
    expect(parseCorrection({ ...base, kind: "void", local: "" })).toMatchObject({ ok: true, value: { kind: "void", local: null } });
    expect(parseCorrection({ ...base, kind: "add" })).toMatchObject({ ok: true, value: { kind: "add", target: null, eventKind: "check_out" } });
    expect(parseCorrection({ ...base, kind: "delete" })).toEqual({ ok: false, problem: "invalid_correction" });
    expect(parseCorrection({ ...base, kind: "void", reason: " a " })).toEqual({ ok: false, problem: "reason_required" });
    expect(parseCorrection({ ...base, kind: "retime", local: "" })).toEqual({ ok: false, problem: "time_required" });
    expect(parseCorrection({ ...base, kind: "void", target: "x" })).toEqual({ ok: false, problem: "invalid_correction" });
    expect(parseCorrection({ ...base, kind: "add", eventKind: "lunch" })).toEqual({ ok: false, problem: "invalid_correction" });
  });

  it("accepts a typed employee ID and nothing odd", () => {
    expect(normaliseEmployeeCode(" 1001 ")).toBe("1001");
    expect(normaliseEmployeeCode("")).toBeNull();
    expect(normaliseEmployeeCode("1".repeat(41))).toBeNull();
    expect(normaliseEmployeeCode("10\n01")).toBeNull();
    expect(normaliseEmployeeCode(1001)).toBeNull();
  });

  it("only takes a bounded list of base64 frames", () => {
    const frame = "QUJD";
    expect(checkFrames(Array(8).fill(frame))).toHaveLength(8);
    expect(checkFrames(Array(7).fill(frame))).toBeNull();
    expect(checkFrames(Array(41).fill(frame))).toBeNull();
    expect(checkFrames([...Array(7).fill(frame), "data:image/jpeg;base64,QUJD"])).toBeNull();
    expect(checkFrames("frames")).toBeNull();
  });

  it("the browser may only report failures that cannot create an event, and the database agrees", () => {
    for (const reason of CLIENT_FAILURES) {
      expect(isClientFailure(reason)).toBe(true);
      expect(migration).toContain(`'${reason}'`);
    }
    for (const claim of ["success", "face_matched", "liveness_passed", "succeeded"]) expect(isClientFailure(claim)).toBe(false);
  });

  it("every reason the kiosk can show has an Arabic and English message; unknown codes are generic", () => {
    for (const locale of ["en", "ar"] as const) {
      const reasons = getMessages(locale).attendance.reason as Record<string, string>;
      for (const reason of KIOSK_REASONS) expect(reasons[reason], `${locale} ${reason}`).toBeTruthy();
      expect(reasons.failed).toBeTruthy();
    }
    expect(kioskReason("face_mismatch")).toBe("face_mismatch");
    expect(kioskReason("<script>")).toBe("failed");
  });

  it("every database error the actions map has a message", () => {
    for (const code of Object.values(ATTENDANCE_ERRORS)) {
      expect(getMessages("en").errors, code).toHaveProperty(code);
      expect(getMessages("ar").errors, code).toHaveProperty(code);
    }
    expect(attendanceErrorCode("something else")).toBe("unexpected");
  });
});
