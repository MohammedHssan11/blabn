"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";

interface Props {
  /** Language to switch to, e.g. "en". */
  target: string;
  /** Name of the target language written in that language, e.g. "English". */
  label: string;
  /** Accessible label of the control, in the current language. */
  title: string;
}

/** Path of the same page in the other language, keeping the query string. */
function hrefFor(pathname: string, target: string, query: string): string {
  const segments = pathname.split("/");
  segments[1] = target;
  const path = segments.join("/") || `/${target}`;
  return query ? `${path}?${query}` : path;
}

function WithQuery({ target, label, title }: Props) {
  const pathname = usePathname();
  const query = useSearchParams().toString();
  return <SwitchLink href={hrefFor(pathname, target, query)} target={target} label={label} title={title} />;
}

function WithoutQuery({ target, label, title }: Props) {
  const pathname = usePathname();
  return <SwitchLink href={hrefFor(pathname, target, "")} target={target} label={label} title={title} />;
}

// A plain link (full page load): the server saves the chosen language when the new page is opened.
function SwitchLink({ href, target, label, title }: Props & { href: string }) {
  return (
    <a className="lang-switch" href={href} hrefLang={target} lang={target} aria-label={title} data-switch-to={target}>
      {label}
    </a>
  );
}

export function LanguageSwitch(props: Props) {
  return (
    <Suspense fallback={<WithoutQuery {...props} />}>
      <WithQuery {...props} />
    </Suspense>
  );
}
