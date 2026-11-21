import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { formatEventDateTime } from "@/i18n/format";
import { first, type SearchParams } from "@/lib/search-params";
import { AccessMatrix, selectionOf } from "@/components/AccessMatrix";
import { AuditTable } from "@/components/AuditTable";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { getStaff, listAudit, listBranches } from "@/modules/access/directory";
import { resetStaffPasswordAction, setStaffAccessAction, setStaffActiveAction, updateStaffAction } from "@/modules/access/staff-actions";
import { MIN_PASSWORD_LENGTH } from "@/modules/access/forms";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("staff.title") : undefined };
}

const AUDIT_TIMEZONE = "Africa/Casablanca";

export default async function StaffDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  await requireAccess({ locale, path: `/${locale}/admin/staff/${id}`, require: { permission: "admin.users.manage" } });
  const t = createTranslator(locale);

  const [staff, branches] = await Promise.all([getStaff(id), listBranches()]);
  if (!staff) notFound();
  const history = await listAudit({ targetId: staff.userId, limit: 30 });

  return (
    <>
      <p>
        <Link href={`/${locale}/admin/staff`}>← {t("staff.back")}</Link>
      </p>
      <h1>{staff.fullName}</h1>
      <p className="lead" dir="ltr" style={{ textAlign: "start" }}>
        {staff.email}
      </p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} warning={first(sp.warning)} />

      <div className="two-col">
        <section className="card stack" data-section="details">
          <h2 style={{ marginTop: 0 }}>{t("staff.detailsTitle")}</h2>
          <form action={updateStaffAction} className="stack" data-form="update-staff">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="staff_id" value={staff.userId} />
            <label>
              {t("staff.fullName")}
              <input type="text" name="full_name" required defaultValue={staff.fullName} autoComplete="off" />
            </label>
            <label>
              {t("common.email")}
              <input type="email" name="email" required defaultValue={staff.email} autoComplete="off" spellCheck={false} autoCapitalize="none" />
            </label>
            <label>
              {t("staff.employeeNumber")} ({t("common.optional")})
              <input type="text" name="employee_number" defaultValue={staff.employeeNumber ?? ""} autoComplete="off" />
            </label>
            <div className="row-actions">
              <button type="submit">{t("common.save")}</button>
            </div>
          </form>
        </section>

        <section className="card stack" data-section="status">
          <h2 style={{ marginTop: 0 }}>{t("staff.statusTitle")}</h2>
          <p>
            <span className={`badge ${staff.isActive ? "ok" : "bad"}`} data-status={staff.isActive ? "active" : "disabled"}>
              {t(staff.isActive ? "staff.statusActive" : "staff.statusDisabled")}
            </span>
          </p>
          {!staff.isActive && staff.disabledAt ? (
            <p className="legend" style={{ marginTop: 0 }}>
              {t("staff.disabledOn", { date: formatEventDateTime(staff.disabledAt, locale, AUDIT_TIMEZONE) })}
              {staff.disabledReason ? ` · ${t("staff.disabledReason", { reason: staff.disabledReason })}` : ""}
            </p>
          ) : null}
          {staff.isActive ? (
            <form action={setStaffActiveAction} className="stack" data-form="disable-staff">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="staff_id" value={staff.userId} />
              <input type="hidden" name="active" value="0" />
              <label>
                {t("staff.reason")} ({t("common.optional")})
                <input type="text" name="reason" autoComplete="off" maxLength={200} />
              </label>
              <p className="legend" style={{ marginTop: 0 }}>
                {t("staff.disableHelp")}
              </p>
              <div className="row-actions">
                <button type="submit" className="danger">
                  {t("staff.disable")}
                </button>
              </div>
            </form>
          ) : (
            <form action={setStaffActiveAction} data-form="reactivate-staff">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="staff_id" value={staff.userId} />
              <input type="hidden" name="active" value="1" />
              <button type="submit">{t("staff.reactivate")}</button>
            </form>
          )}
        </section>
      </div>

      <section className="card stack" data-section="access" style={{ marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>{t("staff.accessTitle")}</h2>
        <p className="legend" style={{ marginTop: 0 }}>
          {t("staff.accessIntro")}
        </p>
        <form action={setStaffAccessAction} className="stack" data-form="set-access">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="staff_id" value={staff.userId} />
          <AccessMatrix locale={locale} t={t} branches={branches} selection={selectionOf(staff)} />
          <div className="row-actions">
            <button type="submit">{t("staff.saveAccess")}</button>
          </div>
        </form>
      </section>

      <section className="card stack" data-section="password" style={{ marginTop: 12 }}>
        <h2 style={{ marginTop: 0 }}>{t("staff.passwordTitle")}</h2>
        <p className="legend" style={{ marginTop: 0 }}>
          {t("staff.passwordHelp")}
        </p>
        <form action={resetStaffPasswordAction} className="stack" data-form="reset-password">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="staff_id" value={staff.userId} />
          <label>
            {t("staff.temporaryPassword")}
            <input type="password" name="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
          </label>
          <div className="row-actions">
            <button type="submit" className="secondary">
              {t("staff.setTemporary")}
            </button>
          </div>
        </form>
      </section>

      <h2>{t("staff.historyTitle")}</h2>
      {history.length === 0 ? <p className="notice">{t("staff.historyEmpty")}</p> : <AuditTable rows={history} locale={locale} t={t} />}
      <p>
        <Link href={`/${locale}/admin/audit`}>{t("staff.openAudit")}</Link>
      </p>
    </>
  );
}
