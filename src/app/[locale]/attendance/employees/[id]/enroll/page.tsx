import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { EnrollCapture } from "@/components/attendance/EnrollCapture";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { requireAccess } from "@/modules/access/guard";
import { readEmployee } from "@/modules/attendance/data";
import { IDENTITY_DOCUMENTS, isUuid, KIOSK_HINTS, KIOSK_REASONS } from "@/modules/attendance/forms";
import { verifierConfigured } from "@/modules/attendance/verifier";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("attendance.enroll.title") : undefined };
}

export default async function EnrollPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!isLocale(locale) || !isUuid(id)) notFound();
  const back = `/${locale}/attendance/employees/${id.toLowerCase()}`;
  await requireAccess({ locale, path: `${back}/enroll`, require: { permission: "attendance.enroll", branch: OPERATING_BRANCH_CODE } });
  const t = createTranslator(locale);
  const employee = await readEmployee(id.toLowerCase());
  if (!employee || employee.branchCode !== OPERATING_BRANCH_CODE) notFound();
  const reasons = Object.fromEntries(KIOSK_REASONS.map((r) => [r, t(`attendance.reason.${r}` as MessageKey)]));

  return (
    <>
      <p><Link href={back}>{employee.name}</Link></p>
      <h1>{t("attendance.enroll.title")}: {employee.name}</h1>
      <div className="enroll-number" data-employee-code={employee.code}>
        <span>{t("attendance.enroll.yourNumber")}</span>
        <strong dir="ltr">{employee.code}</strong>
        <span>{t("attendance.enroll.tellEmployee", { code: employee.code })}</span>
      </div>
      <div className="card stack">
        <p>{t("attendance.enroll.intro")}</p>
        <ol>
          <li>{t("attendance.enroll.step1")}</li>
          <li>{t("attendance.enroll.step2")}</li>
          <li>{t("attendance.enroll.step3")}</li>
        </ol>
        <p className="muted">{t("attendance.enroll.privacy")}</p>
      </div>
      {!employee.attendanceActive || !employee.employeeActive ? (
        <p className="notice bad" role="alert">{t("errors.attendance_employee_inactive")}</p>
      ) : !verifierConfigured() ? (
        <p className="notice bad" role="alert" data-verifier="missing">{t("attendance.reason.verifier_unavailable")}</p>
      ) : (
        <EnrollCapture
          employee={employee.id}
          backHref={back}
          messages={{
            document: t("attendance.enroll.document"),
            documents: Object.fromEntries(IDENTITY_DOCUMENTS.map((d) => [d, t(`attendance.documents.${d}` as MessageKey)])),
            consent: t("attendance.enroll.consent"),
            start: t("attendance.enroll.start"),
            lookAtCamera: t("attendance.kiosk.lookAtCamera"),
            steps: { left: t("attendance.kiosk.step.left"), right: t("attendance.kiosk.step.right"), up: t("attendance.kiosk.step.up") },
            sending: t("attendance.enroll.sending"),
            done: t("attendance.enroll.done"),
            doneReplaced: t("attendance.enroll.doneReplaced"),
            failed: t("attendance.reason.failed"),
            reasons: { ...reasons, consent_required: t("errors.attendance_consent_required"), identity_document_required: t("errors.attendance_identity_required"),
              forbidden: t("errors.forbidden"), employee_inactive: t("errors.attendance_employee_inactive") },
            hints: Object.fromEntries(KIOSK_HINTS.map((h) => [h, t(`attendance.hint.${h}` as MessageKey)])),
            autoRetry: t("attendance.enroll.autoRetry"),
            back: t("attendance.enroll.back"),
            again: t("attendance.enroll.again"),
          }}
        />
      )}
    </>
  );
}
