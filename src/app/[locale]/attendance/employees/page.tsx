import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { holds } from "@/modules/access/session";
import { createEmployeeAction, registerEmployeeAction } from "@/modules/attendance/actions";
import { listEmployees, listUnregistered } from "@/modules/attendance/data";
import { formatLocal } from "@/modules/attendance/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("attendance.employees.title") : undefined };
}

export default async function AttendanceEmployeesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  const access = await requireAccess({ locale, path: `/${locale}/attendance/employees`, require: { permission: "attendance.view", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const canManage = holds(access, "attendance.employees.manage", OPERATING_BRANCH_CODE);
  const [employees, unregistered] = await Promise.all([
    listEmployees(OPERATING_BRANCH_CODE),
    canManage ? listUnregistered(OPERATING_BRANCH_CODE) : Promise.resolve([]),
  ]);

  return (
    <>
      <p><Link href={`/${locale}/attendance`}>{t("attendance.title")}</Link></p>
      <h1>{t("attendance.employees.title")}</h1>
      <p className="lead">{t("attendance.employees.intro")}</p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />

      {canManage ? (
        <div className="grid-2">
          <form action={createEmployeeAction} className="card stack" data-form="attendance-create" id="add">
            <h2>{t("attendance.employees.add")}</h2>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="request" value={randomUUID()} />
            <label>{t("common.name")}<input name="full_name" required minLength={2} maxLength={120} autoComplete="off" /></label>
            <p className="muted">{t("attendance.employees.idGenerated")}</p>
            <p><button type="submit">{t("attendance.employees.addButton")}</button></p>
          </form>
          {unregistered.length > 0 ? (
            <form action={registerEmployeeAction} className="card stack" data-form="attendance-register">
              <h2>{t("attendance.employees.registerExisting")}</h2>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="request" value={randomUUID()} />
              <label>
                {t("common.name")}
                <select name="employee" required className="wide">
                  {unregistered.map((e) => <option key={e.id} value={e.id}>{e.name}{e.code ? ` (${e.code})` : ""}</option>)}
                </select>
              </label>
              <p><button type="submit">{t("attendance.employees.registerButton")}</button></p>
            </form>
          ) : null}
        </div>
      ) : null}

      <h2>{t("attendance.employees.list")}</h2>
      {employees.length === 0 ? <p className="notice">{t("attendance.employees.empty")}</p> : (
        <div className="table-wrap">
          <table data-table="attendance-employees">
            <thead>
              <tr>
                <th>{t("attendance.employeeId")}</th>
                <th>{t("common.name")}</th>
                <th>{t("common.status")}</th>
                <th>{t("attendance.face")}</th>
                <th>{t("attendance.lastEvent")}</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} data-employee={e.code} data-active={e.attendanceActive && e.employeeActive ? "true" : "false"}>
                  <td dir="ltr" style={{ textAlign: "start" }}><strong>{e.code}</strong></td>
                  <td><Link href={`/${locale}/attendance/employees/${e.id}`}>{e.name}</Link></td>
                  <td>
                    <span className={`badge ${e.attendanceActive && e.employeeActive ? "ok" : "bad"}`}>
                      {t(e.attendanceActive && e.employeeActive ? "attendance.active" : "attendance.inactive")}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${e.enrolled ? "ok" : "pending"}`} data-enrolled={e.enrolled ? "true" : "false"}>
                      {t(e.enrolled ? "attendance.enrolled" : "attendance.notEnrolled")}
                    </span>
                  </td>
                  <td>{e.lastEvent ? `${t(e.lastEvent.kind === "check_in" ? "attendance.action.check_in" : "attendance.action.check_out")} · ${formatLocal(e.lastEvent.local, locale)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
