import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { createTranslator, type MessageKey } from "@/i18n/dictionary";
import { KioskScreen } from "@/components/attendance/KioskScreen";
import { requireAccess } from "@/modules/access/guard";
import { readKioskContext } from "@/modules/attendance/data";
import { KIOSK_HINTS, KIOSK_REASONS } from "@/modules/attendance/forms";
import { verifierConfigured } from "@/modules/attendance/verifier";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { title: isLocale(locale) ? createTranslator(locale)("attendance.kiosk.title") : undefined };
}

/**
 * The attendance kiosk screen. Only a signed-in account that the database recognises as an active,
 * registered, least-privilege kiosk device sees the camera screen; anyone else is told why not.
 */
export default async function KioskPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireAccess({ locale, path: `/${locale}/kiosk` });
  const t = createTranslator(locale);
  const context = await readKioskContext();
  if (context.state !== "ready" || !context.branchCode) {
    return (
      <section className="kiosk-screen" data-kiosk-state={context.state}>
        <h1>{t("attendance.kiosk.title")}</h1>
        <p className="notice bad" role="alert">{t(`attendance.kiosk.state.${["not_a_device", "device_inactive", "account_inactive", "not_authorized", "device_overprivileged"].includes(context.state) ? context.state : "unavailable"}` as MessageKey)}</p>
      </section>
    );
  }
  await requireAccess({ locale, path: `/${locale}/kiosk`, require: { permission: "attendance.event.create", branch: context.branchCode } });
  if (!verifierConfigured()) {
    return (
      <section className="kiosk-screen" data-kiosk-state="verifier_unavailable">
        <h1>{t("attendance.kiosk.title")}</h1>
        <p className="notice bad" role="alert">{t("attendance.reason.verifier_unavailable")}</p>
      </section>
    );
  }
  const branch = locale === "ar" ? context.branchNameAr : context.branchNameEn;
  return (
    <KioskScreen
      messages={{
        title: t("attendance.kiosk.title"),
        device: `${branch ?? ""} · ${context.label ?? ""}`,
        idLabel: t("attendance.kiosk.idLabel"),
        checkIn: t("attendance.action.check_in"),
        checkOut: t("attendance.action.check_out"),
        clear: t("attendance.kiosk.done"),
        erase: t("attendance.kiosk.erase"),
        cameraWarming: t("attendance.kiosk.cameraWarming"),
        hints: Object.fromEntries(KIOSK_HINTS.map((h) => [h, t(`attendance.hint.${h}` as MessageKey)])),
        starting: t("attendance.kiosk.starting"),
        lookAtCamera: t("attendance.kiosk.lookAtCamera"),
        steps: { left: t("attendance.kiosk.step.left"), right: t("attendance.kiosk.step.right"), up: t("attendance.kiosk.step.up") },
        checking: t("attendance.kiosk.checking"),
        recordedIn: t("attendance.kiosk.recordedIn"),
        recordedOut: t("attendance.kiosk.recordedOut"),
        hello: t("attendance.kiosk.hello"),
        currentIn: t("attendance.kiosk.currentIn"),
        currentOut: t("attendance.kiosk.currentOut"),
        tryAgain: t("attendance.kiosk.tryAgain"),
        again: t("attendance.kiosk.again"),
        cancel: t("attendance.kiosk.cancel"),
        privacy: t("attendance.kiosk.privacy"),
        reasons: Object.fromEntries(KIOSK_REASONS.map((r) => [r, t(`attendance.reason.${r}` as MessageKey)])),
        failed: t("attendance.reason.failed"),
        connection: t("attendance.reason.connection_lost"),
        deviceProblem: t("attendance.kiosk.state.not_authorized"),
      }}
    />
  );
}
