import type ExcelJSModule from "exceljs";
import type { AttendanceSummary } from "./summary";

/**
 * Renders the attendance summary as an .xlsx workbook. Kept free of server-only imports so the unit
 * tests render real workbooks and read them back (tests/attendance-export.test.ts).
 *
 * - Values only: no formulas, links or macros. Totals are the application's, from summarise().
 * - Durations are written as Excel time values ([h]:mm:ss) of whole seconds, so Excel shows exactly
 *   the application's figure and sums of the cells equal the total row.
 * - Date-times are the branch-local wall-clock times computed by PostgreSQL.
 * - Names, reasons and typed IDs are written as literal text ("@").
 * - Arabic sheets are right-to-left.
 */

export interface ReportShape {
  branch: { code: string; nameEn: string; nameAr: string; timezone: string };
  from: string;
  to: string;
  generatedLocal: string;
  attempts: Array<{ local: string; enteredCode: string; employeeId: string | null; action: string; status: string; reason: string | null; device: string | null }>;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F4" } } as const;
const TOTAL_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5FB" } } as const;
export const DURATION_FORMAT = "[h]:mm:ss";
export const DATETIME_FORMAT = "yyyy-mm-dd hh:mm:ss";

/** Excel serial date of a wall-clock "YYYY-MM-DDTHH:MM:SS" (no time zone conversion). */
export function wallClock(local: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new RangeError(`local time ${local}`);
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

export function durationValue(seconds: number): number {
  return seconds / 86_400;
}

export async function renderAttendanceWorkbook(
  ExcelJS: typeof ExcelJSModule,
  report: ReportShape,
  summary: AttendanceSummary,
  locale: "ar" | "en",
  t: Translate,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Balaban";
  workbook.created = new Date();
  const rtl = locale === "ar";
  const branchName = locale === "ar" ? report.branch.nameAr : report.branch.nameEn;
  const statusLabel = (status: string) => t(`attendance.status.${status}`);

  function sheet(name: string, widths: number[]) {
    const ws = workbook.addWorksheet(name, {
      views: [{ rightToLeft: rtl, state: "frozen", ySplit: 1 }],
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      headerFooter: { oddFooter: "&P / &N" },
    });
    ws.columns = widths.map((width) => ({ width }));
    return ws;
  }
  function header(ws: ExcelJSModule.Worksheet, labels: string[]) {
    const row = ws.addRow(labels);
    row.font = { bold: true };
    row.eachCell((cell) => { cell.fill = HEADER_FILL; cell.alignment = { wrapText: true, vertical: "top" }; });
  }
  function text(cell: ExcelJSModule.Cell, value: string | null) {
    cell.value = value ?? null;
    cell.numFmt = "@";
  }

  // ------------------------------------------------------------------ shifts
  const shifts = sheet(t("attendance.excel.sheetShifts"), [12, 26, 13, 21, 21, 13, 24, 48]);
  header(shifts, [
    t("attendance.excel.employeeId"), t("attendance.excel.name"), t("attendance.excel.reportedDate"), t("attendance.excel.checkIn"),
    t("attendance.excel.checkOut"), t("attendance.excel.duration"), t("attendance.excel.status"), t("attendance.excel.correction"),
  ]);
  for (const shift of summary.shifts) {
    const row = shifts.addRow([]);
    text(row.getCell(1), shift.employeeCode);
    text(row.getCell(2), shift.employeeName);
    text(row.getCell(3), shift.date);
    if (shift.checkIn) { row.getCell(4).value = wallClock(shift.checkIn.local); row.getCell(4).numFmt = DATETIME_FORMAT; }
    if (shift.checkOut) { row.getCell(5).value = wallClock(shift.checkOut.local); row.getCell(5).numFmt = DATETIME_FORMAT; }
    if (shift.seconds !== null) { row.getCell(6).value = durationValue(shift.seconds); row.getCell(6).numFmt = DURATION_FORMAT; }
    text(row.getCell(7), statusLabel(shift.status));
    const notes = [shift.checkIn?.createdBy, shift.checkOut?.createdBy]
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .map((n) => t("attendance.excel.correctionNote", { kind: t(`attendance.correction.kind.${n.kind}`), reason: n.reason, by: n.by, at: n.atLocal.replace("T", " ") }));
    text(row.getCell(8), notes.length ? notes.join(" | ") : null);
  }

  // ------------------------------------------------------------------ totals
  const totals = sheet(t("attendance.excel.sheetTotals"), [12, 26, 16, 18, 18, 22]);
  header(totals, [
    t("attendance.excel.employeeId"), t("attendance.excel.name"), t("attendance.excel.completeShifts"), t("attendance.excel.totalWorked"),
    t("attendance.excel.missingCheckOuts"), t("attendance.excel.checkOutsWithoutCheckIn"),
  ]);
  for (const e of summary.employees) {
    const row = totals.addRow([]);
    text(row.getCell(1), e.code);
    text(row.getCell(2), e.name);
    row.getCell(3).value = e.completeShifts;
    row.getCell(4).value = durationValue(e.workedSeconds);
    row.getCell(4).numFmt = DURATION_FORMAT;
    row.getCell(5).value = e.missingCheckOuts;
    row.getCell(6).value = e.checkOutsWithoutCheckIn;
  }
  const total = totals.addRow([]);
  text(total.getCell(2), t("attendance.excel.grandTotal"));
  total.getCell(3).value = summary.completeShifts;
  total.getCell(4).value = durationValue(summary.totalSeconds);
  total.getCell(4).numFmt = DURATION_FORMAT;
  total.getCell(5).value = summary.employees.reduce((s, e) => s + e.missingCheckOuts, 0);
  total.getCell(6).value = summary.employees.reduce((s, e) => s + e.checkOutsWithoutCheckIn, 0);
  total.font = { bold: true };
  total.eachCell((cell) => { cell.fill = TOTAL_FILL; });

  // ------------------------------------------------------------------ exceptions and corrections
  const exceptions = sheet(t("attendance.excel.sheetExceptions"), [21, 14, 26, 14, 16, 30, 22]);
  header(exceptions, [
    t("attendance.excel.time"), t("attendance.excel.enteredId"), t("attendance.excel.name"), t("attendance.excel.action"),
    t("attendance.excel.outcome"), t("attendance.excel.reason"), t("attendance.excel.device"),
  ]);
  const names = new Map(summary.employees.map((e) => [e.id, e.name]));
  for (const a of report.attempts) {
    const row = exceptions.addRow([]);
    row.getCell(1).value = wallClock(a.local);
    row.getCell(1).numFmt = DATETIME_FORMAT;
    text(row.getCell(2), a.enteredCode);
    text(row.getCell(3), a.employeeId ? names.get(a.employeeId) ?? null : null);
    text(row.getCell(4), t(`attendance.action.${a.action === "check_out" ? "check_out" : "check_in"}`));
    text(row.getCell(5), t(`attendance.attemptStatus.${["refused", "failed", "expired", "superseded", "pending"].includes(a.status) ? a.status : "failed"}`));
    text(row.getCell(6), a.reason ? t(`attendance.reason.${a.reason}`) : null);
    text(row.getCell(7), a.device);
  }
  for (const e of summary.replaced) {
    const row = exceptions.addRow([]);
    row.getCell(1).value = wallClock(e.local);
    row.getCell(1).numFmt = DATETIME_FORMAT;
    text(row.getCell(3), names.get(e.employeeId) ?? null);
    text(row.getCell(4), t(`attendance.action.${e.kind}`));
    text(row.getCell(5), t("attendance.excel.replacedEvent"));
    text(row.getCell(6), e.replacedBy
      ? t("attendance.excel.correctionNote", { kind: t(`attendance.correction.kind.${e.replacedBy.kind}`), reason: e.replacedBy.reason, by: e.replacedBy.by, at: e.replacedBy.atLocal.replace("T", " ") })
      : null);
    text(row.getCell(7), e.device);
  }

  // ------------------------------------------------------------------ about
  const about = sheet(t("attendance.excel.sheetAbout"), [34, 80]);
  const kv = (k: string, v: string) => { const row = about.addRow([]); text(row.getCell(1), k); text(row.getCell(2), v); row.getCell(1).font = { bold: true }; };
  kv(t("attendance.excel.title"), branchName);
  kv(t("attendance.excel.period"), `${report.from} → ${report.to}`);
  kv(t("attendance.excel.generated"), report.generatedLocal.replace("T", " "));
  kv(t("attendance.excel.timezone"), report.branch.timezone);
  kv(t("attendance.excel.ruleElapsed"), t("attendance.rules.elapsed"));
  kv(t("attendance.excel.rulePeriod"), t("attendance.rules.period"));
  kv(t("attendance.excel.ruleIncomplete"), t("attendance.rules.incomplete"));

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}
