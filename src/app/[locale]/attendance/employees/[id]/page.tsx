import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { readBusinessToday } from "@/lib/database-time";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { correctEventAction, deleteReferenceAction, renameEmployeeAction, setEmployeeActiveAction } from "@/modules/attendance/actions";
import { readEmployee, readReport } from "@/modules/attendance/data";
import { isUuid, parsePeriod } from "@/modules/attendance/forms";
import { formatDuration } from "@/modules/attendance/hours";
import { summarise } from "@/modules/attendance/summary";
import { formatLocal, inputLocal, StatusBadge } from "@/modules/attendance/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("attendance.employee.title") : undefined };
}

export default async function AttendanceEmployeePage({ params, searchParams }: { params: Promise<{ locale: string; id: string }>; searchParams: Promise<SearchParams> }) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !isUuid(id)) notFound();
  const sp = await searchParams;
  const path = `/attendance/employees/${id.toLowerCase()}`;
  const access = await requireAccess({ locale, path: `/${locale}${path}`, require: { permission: "attendance.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const employee = await readEmployee(id.toLowerCase());
  if (!employee || employee.branchCode !== OPERATING_BRANCH_CODE) notFound();
  const period = parsePeriod(first(sp.from), first(sp.to), await readBusinessToday()) ?? parsePeriod(undefined, undefined, await readBusinessToday())!;
  const report = await readReport(OPERATING_BRANCH_CODE, period.from, period.to, "view");
  const mine = summarise({ ...report, employees: report.employees.filter((e) => e.id === employee.id),
    events: report.events.filter((e) => e.employeeId === employee.id) });
  const events = report.events.filter((e) => e.employeeId === employee.id && e.inPeriod);
  const canManage = holds(access, "attendance.employees.manage", OPERATING_BRANCH_CODE);
  const canEnroll = holds(access, "attendance.enroll", OPERATING_BRANCH_CODE);
  const canCorrect = holds(access, "attendance.correct", OPERATING_BRANCH_CODE);
  const active = employee.attendanceActive && employee.employeeActive;
  const returnTo = `${path}?from=${period.from}&to=${period.to}`;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="employee" value={employee.id} />
    </>
  );

  return (
    <>
      <p><Link href={`/${locale}/attendance/employees`}>{t("attendance.employees.title")}</Link></p>
      <h1>{employee.name} <span className="muted" dir="ltr">#{employee.code}</span></h1>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />

      <div className="grid-2">
        <section className="card stack" data-section="profile">
          <h2>{t("attendance.employee.profile")}</h2>
          <p>
            <span className={`badge ${active ? "ok" : "bad"}`} data-active={active ? "true" : "false"}>{t(active ? "attendance.active" : "attendance.inactive")}</span>
            {!employee.employeeActive ? <> <span className="muted">{t("attendance.employee.staffDisabled")}</span></> : null}
          </p>
          <p className="muted">{t("attendance.employee.registered", { time: formatLocal(employee.registeredLocal, locale) })}</p>
          {employee.deactivationReason ? <p className="muted">{t("attendance.employee.deactivatedBecause", { reason: employee.deactivationReason, time: formatLocal(employee.deactivatedLocal, locale) })}</p> : null}
          {canManage && !employee.hasStaffAccount ? (
            <form action={renameEmployeeAction} className="mini-form" data-form="attendance-rename">
              {hidden}
              <label>{t("common.name")}<input name="full_name" defaultValue={employee.name} required minLength={2} maxLength={120} /></label>
              <button type="submit" className="secondary">{t("attendance.employee.rename")}</button>
            </form>
          ) : employee.hasStaffAccount ? <p className="muted">{t("attendance.employee.staffName")}</p> : null}
          {canManage ? (
            <form action={setEmployeeActiveAction} className="mini-form" data-form="attendance-active">
              {hidden}
              <input type="hidden" name="active" value={employee.attendanceActive ? "false" : "true"} />
              {employee.attendanceActive ? <label>{t("attendance.reason.label")}<input name="reason" required minLength={3} maxLength={500} /></label> : null}
              <button type="submit" className={employee.attendanceActive ? "danger" : ""}>
                {t(employee.attendanceActive ? "attendance.deactivate" : "attendance.activate")}
              </button>
            </form>
          ) : null}
        </section>

        <section className="card stack" data-section="face">
          <h2>{t("attendance.face")}</h2>
          <p>
            <span className={`badge ${employee.enrolled ? "ok" : "pending"}`} data-enrolled={employee.enrolled ? "true" : "false"}>
              {t(employee.enrolled ? "attendance.enrolled" : "attendance.notEnrolled")}
            </span>
            {employee.enrolledLocal ? <> <span className="muted">{formatLocal(employee.enrolledLocal, locale)}</span></> : null}
          </p>
          <p className="muted">{t("attendance.employee.faceStorage")}</p>
          {canEnroll && active ? (
            <p><Link className="primary-link" href={`/${locale}${path}/enroll`} data-action="enroll">{t(employee.enrolled ? "attendance.employee.reEnroll" : "attendance.employee.enroll")}</Link></p>
          ) : null}
          {canEnroll && employee.enrolled ? (
            <form action={deleteReferenceAction} className="mini-form" data-form="attendance-delete-reference">
              {hidden}
              <label>{t("attendance.reason.label")}<input name="reason" required minLength={3} maxLength={500} /></label>
              <button type="submit" className="danger">{t("attendance.employee.deleteReference")}</button>
            </form>
          ) : null}
          {employee.references.length > 0 ? (
            <details>
              <summary>{t("attendance.employee.referenceHistory")}</summary>
              <ul className="plain-list">
                {employee.references.map((r) => (
                  <li key={r.id} data-reference-status={r.status}>
                    {t(`attendance.referenceStatus.${r.status}` as MessageKey)} · {formatLocal(r.enrolledLocal, locale)}
                    {r.enrolledBy ? ` · ${r.enrolledBy}` : ""} · {t(`attendance.documents.${r.identityDocument}` as MessageKey)}
                    {r.endedLocal ? ` · ${formatLocal(r.endedLocal, locale)}${r.endReason ? ` (${r.endReason})` : ""}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </div>

      <h2>{t("attendance.shifts")}</h2>
      <form method="get" className="mini-form card" data-form="period">
        <label>{t("attendance.from")}<input type="date" name="from" defaultValue={period.from} required /></label>
        <label>{t("attendance.to")}<input type="date" name="to" defaultValue={period.to} required /></label>
        <button type="submit">{t("attendance.show")}</button>
        <strong data-seconds={mine.totalSeconds}>{t("attendance.workedTime")}: {formatDuration(mine.totalSeconds)}</strong>
      </form>
      {mine.shifts.length === 0 ? <p className="notice">{t("attendance.noShifts")}</p> : (
        <div className="table-wrap">
          <table data-table="employee-shifts">
            <thead>
              <tr><th>{t("attendance.checkIn")}</th><th>{t("attendance.checkOut")}</th><th className="numeric">{t("attendance.duration")}</th><th>{t("common.status")}</th></tr>
            </thead>
            <tbody>
              {mine.shifts.map((s) => (
                <tr key={(s.checkIn ?? s.checkOut)!.id} data-shift-status={s.status}>
                  <td>{formatLocal(s.checkIn?.local, locale)}</td>
                  <td>{formatLocal(s.checkOut?.local, locale)}</td>
                  <td className="numeric" data-seconds={s.seconds ?? ""}>{formatDuration(s.seconds)}</td>
                  <td><StatusBadge status={s.status} t={t} />{s.corrected ? <> <span className="badge">{t("attendance.corrected")}</span></> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>{t("attendance.events")}</h2>
      <p className="muted">{t("attendance.eventsIntro")}</p>
      {events.length === 0 ? <p className="notice">{t("attendance.noEvents")}</p> : (
        <div className="table-wrap">
          <table data-table="employee-events">
            <thead>
              <tr><th>{t("attendance.time")}</th><th>{t("attendance.action.label")}</th><th>{t("attendance.source")}</th><th>{t("attendance.correction.title")}</th>{canCorrect ? <th>{t("common.actions")}</th> : null}</tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} data-event={e.id} data-effective={e.effective ? "true" : "false"}>
                  <td>{e.effective ? formatLocal(e.local, locale) : <s>{formatLocal(e.local, locale)}</s>}</td>
                  <td>{t(e.kind === "check_in" ? "attendance.action.check_in" : "attendance.action.check_out")}</td>
                  <td>{t(e.source === "kiosk" ? "attendance.sourceKiosk" : "attendance.sourceCorrection")}{e.device ? ` · ${e.device}` : ""}</td>
                  <td>
                    {e.createdBy ? <div>{t("attendance.correction.createdBy", { kind: t(`attendance.correction.kind.${e.createdBy.kind}` as MessageKey), by: e.createdBy.by, at: formatLocal(e.createdBy.atLocal, locale), reason: e.createdBy.reason })}</div> : null}
                    {e.replacedBy ? <div>{t("attendance.correction.replacedBy", { kind: t(`attendance.correction.kind.${e.replacedBy.kind}` as MessageKey), by: e.replacedBy.by, at: formatLocal(e.replacedBy.atLocal, locale), reason: e.replacedBy.reason })}</div> : null}
                    {!e.createdBy && !e.replacedBy ? "—" : null}
                  </td>
                  {canCorrect ? (
                    <td>
                      {e.effective ? (
                        <details>
                          <summary>{t("attendance.correction.correct")}</summary>
                          <form action={correctEventAction} className="stack-tight" data-form="attendance-retime">
                            {hidden}
                            <input type="hidden" name="request" value={randomUUID()} />
                            <input type="hidden" name="kind" value="retime" />
                            <input type="hidden" name="target" value={e.id} />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <label>{t("attendance.correction.newTime")}<input type="datetime-local" name="local" defaultValue={inputLocal(e.local)} step={60} required /></label>
                            <label>{t("attendance.reason.label")}<input name="reason" required minLength={3} maxLength={500} /></label>
                            <button type="submit" className="secondary">{t("attendance.correction.retime")}</button>
                          </form>
                          <form action={correctEventAction} className="stack-tight" data-form="attendance-void">
                            {hidden}
                            <input type="hidden" name="request" value={randomUUID()} />
                            <input type="hidden" name="kind" value="void" />
                            <input type="hidden" name="target" value={e.id} />
                            <input type="hidden" name="return_to" value={returnTo} />
                            <label>{t("attendance.reason.label")}<input name="reason" required minLength={3} maxLength={500} /></label>
                            <button type="submit" className="danger">{t("attendance.correction.void")}</button>
                          </form>
                        </details>
                      ) : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCorrect ? (
        <form action={correctEventAction} className="card mini-form" data-form="attendance-add">
          <h3>{t("attendance.correction.addTitle")}</h3>
          {hidden}
          <input type="hidden" name="request" value={randomUUID()} />
          <input type="hidden" name="kind" value="add" />
          <input type="hidden" name="return_to" value={returnTo} />
          <label>
            {t("attendance.action.label")}
            <select name="event_kind" required>
              <option value="check_in">{t("attendance.action.check_in")}</option>
              <option value="check_out">{t("attendance.action.check_out")}</option>
            </select>
          </label>
          <label>{t("attendance.time")}<input type="datetime-local" name="local" step={60} required /></label>
          <label>{t("attendance.reason.label")}<input name="reason" required minLength={3} maxLength={500} /></label>
          <button type="submit">{t("attendance.correction.add")}</button>
        </form>
      ) : null}
    </>
  );
}
