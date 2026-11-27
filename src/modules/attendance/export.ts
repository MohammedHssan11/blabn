import "server-only";
import ExcelJS from "exceljs";
import type { Locale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import type { AttendanceReport } from "./data";
import { summarise } from "./summary";
import { renderAttendanceWorkbook } from "./workbook";

/**
 * The attendance Excel report (Phase 14). It has its own permission (attendance.export), separate from
 * the financial report exports. It renders the same summary as the attendance screen.
 */
export async function attendanceWorkbook(report: AttendanceReport, locale: Locale): Promise<Buffer> {
  const t = createTranslator(locale);
  return renderAttendanceWorkbook(ExcelJS, report, summarise(report), locale, (key, params) => t(key as MessageKey, params));
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function attendanceFileName(report: AttendanceReport, locale: Locale): string {
  return `attendance_${report.branch.code}_${report.from}_${report.to}_${locale}.xlsx`;
}
