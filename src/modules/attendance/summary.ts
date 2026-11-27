import { grandTotalSeconds, pairShifts, shiftsInPeriod, totalsByEmployee, type AttendanceEvent, type Shift } from "./hours";

/**
 * The one summary behind the attendance screen AND the attendance Excel file. Both render exactly this
 * structure, so their figures cannot differ. Pure: no database, no server-only import.
 */

export interface SummaryInput {
  from: string;
  to: string;
  employees: Array<{ id: string; name: string; code: string; active: boolean }>;
  events: AttendanceEvent[];
}

export interface EmployeeSummary {
  id: string;
  name: string;
  code: string;
  active: boolean;
  completeShifts: number;
  workedSeconds: number;
  missingCheckOuts: number;
  checkOutsWithoutCheckIn: number;
}

export interface AttendanceSummary {
  shifts: Array<Shift & { employeeName: string; employeeCode: string }>;
  employees: EmployeeSummary[];
  totalSeconds: number;
  completeShifts: number;
  exceptions: number;
  /** Events replaced by a correction whose time falls in the period, shown with the correction. */
  replaced: AttendanceEvent[];
}

export function summarise(input: SummaryInput): AttendanceSummary {
  const byId = new Map(input.employees.map((e) => [e.id, e]));
  const shifts = shiftsInPeriod(pairShifts(input.events), input.from, input.to)
    .filter((shift) => byId.has(shift.employeeId))
    .map((shift) => ({ ...shift, employeeName: byId.get(shift.employeeId)!.name, employeeCode: byId.get(shift.employeeId)!.code }))
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, "en", { numeric: true })
      || (a.checkIn ?? a.checkOut)!.occurredAt.localeCompare((b.checkIn ?? b.checkOut)!.occurredAt));
  const totals = totalsByEmployee(shifts);
  const employees = input.employees
    .map((e) => {
      const t = totals.get(e.id);
      return {
        id: e.id,
        name: e.name,
        code: e.code,
        active: e.active,
        completeShifts: t?.completeShifts ?? 0,
        workedSeconds: t?.workedSeconds ?? 0,
        missingCheckOuts: t?.missingCheckOuts ?? 0,
        checkOutsWithoutCheckIn: t?.checkOutsWithoutCheckIn ?? 0,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const totalSeconds = grandTotalSeconds(shifts);
  if (totalSeconds !== employees.reduce((sum, e) => sum + e.workedSeconds, 0)) {
    throw new Error("attendance totals do not reconcile");
  }
  return {
    shifts,
    employees,
    totalSeconds,
    completeShifts: employees.reduce((sum, e) => sum + e.completeShifts, 0),
    exceptions: shifts.filter((s) => s.status !== "complete").length,
    replaced: input.events.filter((e) => !e.effective && e.inPeriod && e.local.slice(0, 10) >= input.from && e.local.slice(0, 10) <= input.to),
  };
}
