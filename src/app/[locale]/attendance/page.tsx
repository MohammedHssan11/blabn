import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { formatCount } from "@/i18n/format";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { listEmployees, readAttendanceToday, readReport } from "@/modules/attendance/data";
import { parsePeriod } from "@/modules/attendance/forms";
import { formatDuration } from "@/modules/attendance/hours";
import { summarise } from "@/modules/attendance/summary";
import { attemptStatusLabel, formatLocal, reasonLabel, StatusBadge } from "@/modules/attendance/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("attendance.title") : undefined };
}

export default async function AttendancePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const access = await requireAccess({ locale, path: `/${locale}/attendance`, require: { permission: "attendance.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const today = await readAttendanceToday();
  const period = parsePeriod(first(sp.from), first(sp.to), today);
  if (!period) {
    return (
      <>
        <h1>{t("attendance.title")}</h1>
        <p className="notice bad" role="alert">{t("attendance.invalidPeriod")}</p>
        <p><Link href={`/${locale}/attendance`}>{t("attendance.thisMonth")}</Link></p>
      </>
    );
  }
  const [report, todayReport, employees] = await Promise.all([
    readReport(OPERATING_BRANCH_CODE, period.from, period.to, "view"),
    readReport(OPERATING_BRANCH_CODE, today, today, "view"),
    listEmployees(OPERATING_BRANCH_CODE),
  ]);
  const summary = summarise(report);
  const todaySummary = summarise(todayReport);
  const open = employees.filter((e) => e.lastEvent?.kind === "check_in");
  const inNow = open.filter((e) => e.lastEvent!.local.slice(0, 10) === today);
  const toCorrect = summary.shifts.filter((s) => s.status !== "complete" && !(s.status === "missing_check_out" && s.date === today
    && inNow.some((e) => e.id === s.employeeId)));
  const canExport = holds(access, "attendance.export", OPERATING_BRANCH_CODE);
  const query = `branch=${OPERATING_BRANCH_CODE}&from=${period.from}&to=${period.to}`;

  return (
    <>
      <h1>{t("attendance.title")}</h1>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <nav className="quick-links" aria-label={t("attendance.title")}>
        {holds(access, "attendance.employees.manage", OPERATING_BRANCH_CODE) ? (
          <Link className="primary-link" href={`/${locale}/attendance/employees#add`} data-action="add-employee">+ {t("attendance.home.addEmployee")}</Link>
        ) : null}
        <Link className="primary-link" href={`/${locale}/attendance/employees`}>{t("attendance.employees.title")}</Link>
        {holds(access, "attendance.devices.manage", OPERATING_BRANCH_CODE) ? (
          <Link className="primary-link" href={`/${locale}/attendance/devices`}>{t("attendance.home.manageDevices")}</Link>
        ) : null}
      </nav>

      <div className="stat-grid">
        <section className="stat-card" data-card="in-now">
          <h2>{t("attendance.home.inNow")}</h2>
          <div className="stat-value">{formatCount(inNow.length, locale)}</div>
          {inNow.length === 0 ? <p className="muted">{t("attendance.home.nobodyIn")}</p> : (
            <ul>{inNow.map((e) => (
              <li key={e.id}><Link href={`/${locale}/attendance/employees/${e.id}`}>{e.name}</Link>
                <span className="muted">{t("attendance.home.since", { time: e.lastEvent!.local.slice(11, 16) })}</span></li>
            ))}</ul>
          )}
        </section>
        <section className="stat-card" data-card="to-correct">
          <h2>{t("attendance.home.needsCorrection")}</h2>
          <div className="stat-value">{formatCount(toCorrect.length, locale)}</div>
          {toCorrect.length === 0 ? <p className="muted">{t("attendance.home.noneToCorrect")}</p> : (
            <ul>{toCorrect.slice(0, 6).map((s) => (
              <li key={(s.checkIn ?? s.checkOut)!.id}>
                <span>{s.employeeName} · {formatLocal((s.checkIn ?? s.checkOut)!.local, locale)}</span>
                <Link href={`/${locale}/attendance/employees/${s.employeeId}?from=${period.from}&to=${period.to}`}>{t("attendance.home.correct")}</Link>
              </li>
            ))}</ul>
          )}
        </section>
        <section className="stat-card" data-card="today">
          <h2>{t("attendance.home.today")}</h2>
          <div className="stat-value" data-seconds={todaySummary.totalSeconds}>{formatDuration(todaySummary.totalSeconds)}</div>
          <p className="muted">{t("attendance.home.shiftsCount", { count: formatCount(todaySummary.completeShifts, locale) })}</p>
        </section>
        <section className="stat-card" data-card="period">
          <h2>{t("attendance.home.period")}</h2>
          <div className="stat-value">{formatDuration(summary.totalSeconds)}</div>
          <p className="muted">{t("attendance.home.shiftsCount", { count: formatCount(summary.completeShifts, locale) })}</p>
        </section>
      </div>

      <form method="get" className="mini-form card" data-form="period">
        <label>{t("attendance.from")}<input type="date" name="from" defaultValue={period.from} required /></label>
        <label>{t("attendance.to")}<input type="date" name="to" defaultValue={period.to} required /></label>
        <button type="submit">{t("attendance.show")}</button>
        {canExport ? (
          <span className="row-actions">
            <a className="primary-link" href={`/api/attendance/export?${query}&lang=ar`} data-export="ar" download>{t("attendance.exportAr")}</a>
            <a className="primary-link" href={`/api/attendance/export?${query}&lang=en`} data-export="en" download>{t("attendance.exportEn")}</a>
          </span>
        ) : null}
      </form>
      <p className="muted" data-rule="period">{t("attendance.rules.elapsed")} {t("attendance.rules.period")}</p>

      <h2>{t("attendance.totals")}</h2>
      <div className="table-wrap">
        <table data-table="attendance-totals">
          <thead>
            <tr>
              <th>{t("attendance.employeeId")}</th>
              <th>{t("common.name")}</th>
              <th className="numeric">{t("attendance.completeShifts")}</th>
              <th className="numeric">{t("attendance.workedTime")}</th>
              <th className="numeric">{t("attendance.missingCheckOuts")}</th>
              <th className="numeric">{t("attendance.checkOutsWithoutCheckIn")}</th>
            </tr>
          </thead>
          <tbody>
            {summary.employees.map((e) => (
              <tr key={e.id} data-employee={e.code}>
                <td dir="ltr" style={{ textAlign: "start" }}>{e.code}</td>
                <td><Link href={`/${locale}/attendance/employees/${e.id}?from=${period.from}&to=${period.to}`}>{e.name}</Link>{e.active ? null : <> <span className="badge">{t("attendance.inactive")}</span></>}</td>
                <td className="numeric">{formatCount(e.completeShifts, locale)}</td>
                <td className="numeric" data-seconds={e.workedSeconds}>{formatDuration(e.workedSeconds)}</td>
                <td className="numeric">{formatCount(e.missingCheckOuts, locale)}</td>
                <td className="numeric">{formatCount(e.checkOutsWithoutCheckIn, locale)}</td>
              </tr>
            ))}
            <tr data-total="true">
              <td />
              <th scope="row">{t("attendance.grandTotal")}</th>
              <td className="numeric"><strong>{formatCount(summary.completeShifts, locale)}</strong></td>
              <td className="numeric" data-seconds={summary.totalSeconds}><strong>{formatDuration(summary.totalSeconds)}</strong></td>
              <td className="numeric"><strong>{formatCount(summary.employees.reduce((s, e) => s + e.missingCheckOuts, 0), locale)}</strong></td>
              <td className="numeric"><strong>{formatCount(summary.employees.reduce((s, e) => s + e.checkOutsWithoutCheckIn, 0), locale)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>{t("attendance.shifts")}</h2>
      {summary.shifts.length === 0 ? <p className="notice">{t("attendance.noShifts")}</p> : (
        <div className="table-wrap">
          <table data-table="attendance-shifts">
            <thead>
              <tr>
                <th>{t("attendance.employeeId")}</th>
                <th>{t("common.name")}</th>
                <th>{t("attendance.checkIn")}</th>
                <th>{t("attendance.checkOut")}</th>
                <th className="numeric">{t("attendance.duration")}</th>
                <th>{t("common.status")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.shifts.map((s) => (
                <tr key={(s.checkIn ?? s.checkOut)!.id} data-shift-status={s.status}>
                  <td dir="ltr" style={{ textAlign: "start" }}>{s.employeeCode}</td>
                  <td>{s.employeeName}</td>
                  <td>{formatLocal(s.checkIn?.local, locale)}</td>
                  <td>{formatLocal(s.checkOut?.local, locale)}</td>
                  <td className="numeric" data-seconds={s.seconds ?? ""}>{formatDuration(s.seconds)}</td>
                  <td>
                    <StatusBadge status={s.status} t={t} />
                    {s.corrected ? <> <span className="badge">{t("attendance.corrected")}</span></> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>{t("attendance.attempts")}</h2>
      <p className="muted">{t("attendance.attemptsIntro")}</p>
      {report.attempts.length === 0 ? <p className="notice">{t("attendance.noAttempts")}</p> : (
        <div className="table-wrap">
          <table data-table="attendance-attempts">
            <thead>
              <tr>
                <th>{t("attendance.time")}</th>
                <th>{t("attendance.enteredId")}</th>
                <th>{t("attendance.action.label")}</th>
                <th>{t("common.status")}</th>
                <th>{t("attendance.reason.label")}</th>
                <th className="numeric">{t("attendance.matchScore")}</th>
                <th>{t("attendance.device")}</th>
              </tr>
            </thead>
            <tbody>
              {report.attempts.map((a) => (
                <tr key={a.id} data-attempt-reason={a.reason ?? ""}>
                  <td>{formatLocal(a.local, locale)}</td>
                  <td dir="ltr" style={{ textAlign: "start" }}>{a.enteredCode}</td>
                  <td>{t(a.action === "check_out" ? "attendance.action.check_out" : "attendance.action.check_in")}</td>
                  <td>{attemptStatusLabel(a.status, t)}</td>
                  <td>{reasonLabel(a.reason, t)}</td>
                  <td className="numeric">{a.matchScore === null ? "—" : a.matchScore.toFixed(3)}</td>
                  <td>{a.device ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
