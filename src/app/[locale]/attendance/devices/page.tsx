import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { registerDeviceAction, setDeviceActiveAction } from "@/modules/attendance/actions";
import { listDeviceCandidates, listDevices } from "@/modules/attendance/data";
import { formatLocal } from "@/modules/attendance/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("attendance.devices.title") : undefined };
}

export default async function AttendanceDevicesPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  await requireAccess({ locale, path: `/${locale}/attendance/devices`, require: { permission: "attendance.devices.manage", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const [devices, candidates] = await Promise.all([listDevices(OPERATING_BRANCH_CODE), listDeviceCandidates(OPERATING_BRANCH_CODE)]);

  return (
    <>
      <p><Link href={`/${locale}/attendance`}>{t("attendance.title")}</Link></p>
      <h1>{t("attendance.devices.title")}</h1>
      <p className="lead">{t("attendance.devices.intro")}</p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <ol className="card">
        <li>{t("attendance.devices.setup1")}</li>
        <li>{t("attendance.devices.setup2")}</li>
        <li>{t("attendance.devices.setup3")}</li>
      </ol>

      {candidates.length > 0 ? (
        <form action={registerDeviceAction} className="card mini-form" data-form="attendance-device-register">
          <input type="hidden" name="locale" value={locale} />
          <label>
            {t("attendance.devices.account")}
            <select name="account" required className="wide">
              {candidates.map((c) => <option key={c.userId} value={c.userId}>{c.fullName} · {c.email}</option>)}
            </select>
          </label>
          <label>{t("attendance.devices.label")}<input name="label" required maxLength={80} /></label>
          <button type="submit">{t("attendance.devices.register")}</button>
        </form>
      ) : <p className="notice">{t("attendance.devices.noCandidates")}</p>}

      {devices.length === 0 ? <p className="notice">{t("attendance.devices.empty")}</p> : (
        <div className="table-wrap">
          <table data-table="attendance-devices">
            <thead>
              <tr>
                <th>{t("attendance.devices.label")}</th>
                <th>{t("attendance.devices.account")}</th>
                <th>{t("common.status")}</th>
                <th>{t("attendance.devices.lastUse")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} data-device={d.label} data-active={d.active ? "true" : "false"}>
                  <td>{d.label}</td>
                  <td dir="ltr" style={{ textAlign: "start" }}>{d.accountEmail}</td>
                  <td>
                    <span className={`badge ${d.problem ? "bad" : "ok"}`}>{t(d.problem ? `attendance.devices.problem.${d.problem}` as MessageKey : "attendance.devices.ready")}</span>
                    {d.deactivationReason ? <div className="muted">{d.deactivationReason} · {formatLocal(d.deactivatedLocal, locale)}</div> : null}
                  </td>
                  <td>{formatLocal(d.lastAttemptLocal, locale)}</td>
                  <td>
                    <form action={setDeviceActiveAction} className="mini-form" data-form="attendance-device-active">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="device" value={d.id} />
                      <input type="hidden" name="active" value={d.active ? "false" : "true"} />
                      {d.active ? <label>{t("attendance.reason.label")}<input name="reason" required minLength={3} maxLength={500} /></label> : null}
                      <button type="submit" className={d.active ? "danger" : ""}>{t(d.active ? "attendance.deactivate" : "attendance.activate")}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
