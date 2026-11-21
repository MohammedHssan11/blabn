import type { ReactNode } from "react";
import type { Translator } from "@/i18n/dictionary";

export function AuthPanel({ t, children }: { t: Translator; children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-visual" aria-hidden="true">
        <div className="auth-brand">
          <span>{t("app.name")}</span>
          <small>{t("app.tagline")}</small>
        </div>
      </div>
      <div className="auth-panel">
        <div className="auth-card">{children}</div>
      </div>
    </div>
  );
}
