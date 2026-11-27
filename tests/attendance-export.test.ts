import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import type { AttendanceEvent } from "@/modules/attendance/hours";
import { summarise } from "@/modules/attendance/summary";
import { DURATION_FORMAT, renderAttendanceWorkbook, wallClock, type ReportShape } from "@/modules/attendance/workbook";
import { scanWorkbook } from "@/modules/exports/scan";

let n = 0;
function ev(employeeId: string, kind: "check_in" | "check_out", utc: string, local: string, extra: Partial<AttendanceEvent> = {}): AttendanceEvent {
  n += 1;
  return { id: `ev${n}`, employeeId, kind, occurredAt: utc, local, source: "kiosk", effective: true, inPeriod: true, device: "Entrance",
    createdBy: null, replacedBy: null, ...extra };
}

const employees = [
  { id: "a", name: "Synthetic Employee A", code: "1001", active: true },
  { id: "b", name: "=SUM(1)+\"x\"", code: "1002", active: true },
];
const correction = { id: "c1", kind: "retime" as const, reason: "Forgot to check out (synthetic)", by: "Abdo", atLocal: "2026-11-04T10:00:00" };
const events: AttendanceEvent[] = [
  ev("a", "check_in", "2026-11-02T08:05:00Z", "2026-11-02T09:05:00"),
  ev("a", "check_out", "2026-11-02T16:10:00Z", "2026-11-02T17:10:00"),
  ev("a", "check_in", "2026-11-02T21:00:00Z", "2026-11-02T22:00:00"),
  ev("a", "check_out", "2026-11-03T05:00:00Z", "2026-11-03T06:00:00"),
  ev("b", "check_in", "2026-11-03T08:00:07Z", "2026-11-03T09:00:07"),
  ev("b", "check_out", "2026-11-03T18:00:00Z", "2026-11-03T19:00:00", { effective: false, replacedBy: correction }),
  ev("b", "check_out", "2026-11-03T16:00:00Z", "2026-11-03T17:00:00", { source: "correction", createdBy: correction }),
  ev("b", "check_in", "2026-11-04T08:00:00Z", "2026-11-04T09:00:00"),
];
const report: ReportShape = {
  branch: { code: "maarif", nameEn: "Maarif", nameAr: "المعاريف", timezone: "Africa/Casablanca" },
  from: "2026-11-01",
  to: "2026-11-30",
  generatedLocal: "2026-11-26T12:00:00",
  attempts: [
    { local: "2026-11-03T09:10:00", enteredCode: "1002", employeeId: "b", action: "check_in", status: "refused", reason: "already_checked_in", device: "Entrance" },
    { local: "2026-11-03T09:11:00", enteredCode: "9999", employeeId: null, action: "check_in", status: "refused", reason: "unknown_employee", device: "Entrance" },
  ],
};

async function render(locale: "ar" | "en") {
  const summary = summarise({ from: report.from, to: report.to, employees, events });
  const t = createTranslator(locale);
  const bytes = await renderAttendanceWorkbook(ExcelJS, report, summary, locale, (k, p) => t(k as MessageKey, p));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return { summary, bytes, wb };
}

/** ExcelJS reads a cell with a time format back as a Date from the 1899-12-30 epoch; the file stores the day fraction. */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const seconds = (value: unknown) =>
  value instanceof Date ? Math.round((value.getTime() - EXCEL_EPOCH) / 1000) : Math.round(Number(value) * 86_400);

describe("attendance summary", () => {
  it("computes the required examples and keeps the incomplete shift out of the total", () => {
    const s = summarise({ from: report.from, to: report.to, employees, events });
    const a = s.employees.find((e) => e.id === "a")!;
    const b = s.employees.find((e) => e.id === "b")!;
    expect(a.workedSeconds).toBe(8 * 3600 + 5 * 60 + 8 * 3600);
    expect(b.workedSeconds).toBe(7 * 3600 + 59 * 60 + 53);
    expect(b.missingCheckOuts).toBe(1);
    expect(s.totalSeconds).toBe(a.workedSeconds + b.workedSeconds);
    expect(s.replaced.map((e) => e.local)).toEqual(["2026-11-03T19:00:00"]);
  });
});

describe("attendance Excel workbook", () => {
  for (const locale of ["ar", "en"] as const) {
    it(`${locale}: totals in the file equal the screen summary, cell by cell`, async () => {
      const { summary, wb } = await render(locale);
      const [shifts, totals] = wb.worksheets;
      const durations: number[] = [];
      shifts!.eachRow((row, i) => {
        if (i === 1) return;
        const v = row.getCell(6).value;
        if (v !== null && v !== undefined) {
          expect(row.getCell(6).numFmt).toBe(DURATION_FORMAT);
          durations.push(seconds(v));
        }
      });
      expect(durations.reduce((x, y) => x + y, 0)).toBe(summary.totalSeconds);
      expect(durations).toHaveLength(summary.completeShifts);
      const rows = totals!.getRows(2, totals!.rowCount - 1)!;
      for (const e of summary.employees) {
        const row = rows.find((r) => r.getCell(1).value === e.code)!;
        expect(seconds(row.getCell(4).value)).toBe(e.workedSeconds);
        expect(row.getCell(3).value).toBe(e.completeShifts);
        expect(row.getCell(5).value).toBe(e.missingCheckOuts);
      }
      const last = totals!.getRow(totals!.rowCount);
      expect(seconds(last.getCell(4).value)).toBe(summary.totalSeconds);
    });

    it(`${locale}: right-to-left only in Arabic, literal text, no formulas, errors or links`, async () => {
      const { bytes, wb } = await render(locale);
      for (const ws of wb.worksheets) expect(ws.views[0]?.rightToLeft ?? false).toBe(locale === "ar");
      const scan = await scanWorkbook(bytes, locale);
      expect(scan.problems).toEqual([]);
      expect(scan.ok).toBe(true);
      expect(scan.sheets).toBe(4);
      // A name that looks like a formula stays text.
      const shifts = wb.worksheets[0]!;
      const names: unknown[] = [];
      shifts.eachRow((row) => names.push(row.getCell(2).value));
      expect(names).toContain('=SUM(1)+"x"');
    });

    it(`${locale}: the incomplete shift, the correction note and the refused attempts are visible`, async () => {
      const { wb } = await render(locale);
      const t = createTranslator(locale);
      const [shifts, , exceptions] = wb.worksheets;
      const statuses: unknown[] = [];
      const notes: string[] = [];
      shifts!.eachRow((row, i) => {
        if (i === 1) return;
        statuses.push(row.getCell(7).value);
        if (row.getCell(8).value) notes.push(String(row.getCell(8).value));
      });
      expect(statuses).toContain(t("attendance.status.missing_check_out"));
      expect(notes.some((note) => note.includes("Forgot to check out (synthetic)") && note.includes("Abdo"))).toBe(true);
      const reasons: unknown[] = [];
      exceptions!.eachRow((row) => reasons.push(row.getCell(6).value));
      expect(reasons).toContain(t("attendance.reason.already_checked_in"));
      expect(reasons).toContain(t("attendance.reason.unknown_employee"));
    });
  }

  it("Arabic and English files carry identical figures", async () => {
    const [ar, en] = await Promise.all([render("ar"), render("en")]);
    const figures = (wb: ExcelJS.Workbook) => {
      const out: unknown[] = [];
      for (const ws of wb.worksheets.slice(0, 2)) ws.eachRow((row) => row.eachCell((cell) => {
        if (typeof cell.value === "number" || cell.value instanceof Date) out.push(cell.value instanceof Date ? cell.value.toISOString() : cell.value);
      }));
      return out;
    };
    expect(figures(ar.wb)).toEqual(figures(en.wb));
  });

  it("writes wall-clock times without any time-zone shift", () => {
    expect(wallClock("2026-11-02T22:00:00").toISOString()).toBe("2026-11-02T22:00:00.000Z");
    expect(() => wallClock("2026-11-02 22:00")).toThrow();
  });
});
