import type { Translator } from "@/i18n/dictionary";
import { errorMessageKey, noticeMessageKey, warningMessageKey } from "@/modules/access/ui";

/** The error / notice / warning banners that follow a form submission. Codes come from the query string. */
export function ResultMessages({
  t,
  error,
  notice,
  warning,
}: {
  t: Translator;
  error?: string;
  notice?: string;
  warning?: string;
}) {
  const errorKey = errorMessageKey(error);
  const noticeKey = noticeMessageKey(notice);
  const warningKey = warningMessageKey(warning);
  return (
    <>
      {errorKey ? (
        <p role="alert" className="notice bad" data-result="error" data-code={error}>
          {t(errorKey)}
        </p>
      ) : null}
      {noticeKey ? (
        <p role="status" className="notice ok" data-result="notice" data-code={notice}>
          {t(noticeKey)}
        </p>
      ) : null}
      {warningKey ? (
        <p role="status" className="notice warn" data-result="warning" data-code={warning}>
          {t(warningKey)}
        </p>
      ) : null}
    </>
  );
}
