import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator } from "@/i18n/dictionary";
import { first, type SearchParams } from "@/lib/search-params";
import { ResultMessages } from "@/components/Messages";
import { requireAccess } from "@/modules/access/guard";
import { listBranches, listStaff } from "@/modules/access/directory";
import { groupNameKey } from "@/modules/access/ui";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("staff.title") : undefined };
}

export default async function StaffListPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const sp = await searchParams;
  await requireAccess({ locale, path: `/${locale}/admin/staff`, require: { permission: "admin.users.manage" } });
  const t = createTranslator(locale);
  const [staff, branches] = await Promise.all([listStaff(), listBranches()]);
  const branchName = (code: string) => {
    const branch = branches.find((b) => b.code === code);
    return branch ? (locale === "ar" ? branch.nameAr : branch.nameEn) : code;
  };
  const base = `/${locale}/admin/staff`;

  return (
    <>
      <h1>{t("staff.title")}</h1>
      <p className="lead">{t("staff.intro")}</p>
      <ResultMessages t={t} error={first(sp.error)} notice={first(sp.notice)} />
      <p>
        <Link className="badge ok" href={`${base}/new`} data-action="add-staff">
          {t("staff.add")}
        </Link>
      </p>

      {staff.length === 0 ? (
        <p className="notice">{t("staff.empty")}</p>
      ) : (
        <div className="table-wrap">
          <table data-table="staff">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("common.email")}</th>
                <th>{t("staff.employeeNumber")}</th>
                <th>{t("common.status")}</th>
                <th>{t("staff.branchesAndGroups")}</th>
                <th>{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((row) => {
                const organizationGroups = row.groups.filter((g) => g.branch === null);
                return (
                  <tr key={row.userId} data-staff={row.email} data-active={row.isActive ? "true" : "false"}>
                    <td>{row.fullName}</td>
                    <td dir="ltr" style={{ textAlign: "start" }}>
                      {row.email}
                    </td>
                    <td>{row.employeeNumber ?? "—"}</td>
                    <td>
                      <span className={`badge ${row.isActive ? "ok" : "bad"}`}>{t(row.isActive ? "staff.active" : "staff.disabled")}</span>
                      {row.mustChangePassword ? (
                        <>
                          {" "}
                          <span className="badge pending">{t("staff.mustChange")}</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {organizationGroups.map((g) => (
                        <div key={g.group}>{t(groupNameKey(g.group))}</div>
                      ))}
                      {row.branches.map((code) => (
                        <div key={code}>
                          <strong>{branchName(code)}:</strong>{" "}
                          {row.groups.filter((g) => g.branch === code).map((g) => t(groupNameKey(g.group))).join(" · ") || t("staff.noAccess")}
                        </div>
                      ))}
                      {organizationGroups.length === 0 && row.branches.length === 0 ? <span className="muted">{t("staff.noAccess")}</span> : null}
                    </td>
                    <td>
                      <Link href={`${base}/${row.userId}`}>{t("staff.manage")}</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
