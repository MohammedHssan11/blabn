import { NextResponse, type NextRequest } from "next/server";
import { authorizeRequest } from "@/modules/access/guard";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { readAttendanceToday, readReport } from "@/modules/attendance/data";
import { attendanceFileName, attendanceWorkbook, XLSX_TYPE } from "@/modules/attendance/export";
import { parsePeriod } from "@/modules/attendance/forms";

/**
 * Attendance Excel download. Needs attendance.export for the branch: a permission of its own, separate
 * from the financial report exports. The database checks it again and records the export.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: NextRequest) {
  const branch = request.nextUrl.searchParams.get("branch") ?? OPERATING_BRANCH_CODE;
  const decision = await authorizeRequest({ permission: "attendance.export", branch });
  if (!decision.ok) return decision.response;
  const locale = request.nextUrl.searchParams.get("lang") === "en" ? "en" : "ar";
  const period = parsePeriod(request.nextUrl.searchParams.get("from") ?? undefined, request.nextUrl.searchParams.get("to") ?? undefined,
    await readAttendanceToday());
  if (!period) return NextResponse.json({ error: "invalid_period" }, { status: 400, headers: NO_STORE });

  const report = await readReport(branch, period.from, period.to, "export", locale);
  const bytes = await attendanceWorkbook(report, locale);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${attendanceFileName(report, locale)}"`,
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
