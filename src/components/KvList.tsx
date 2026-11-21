import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import type { Trace } from "@/modules/reports/trace";
import { TraceTag } from "./values";

export interface KvItem {
  label: string;
  trace?: Trace;
  value: ReactNode;
  id?: string;
}

/** Label / value rows. The trace of each value is shown under its label. */
export function KvList({ items, locale }: { items: KvItem[]; locale: Locale }) {
  return (
    <ul className="kv-list">
      {items.map((item, index) => (
        <li className="kv-row" key={item.id ?? index} data-kv={item.id}>
          <span className="label">
            {item.label}
            {item.trace ? <TraceTag trace={item.trace} locale={locale} /> : null}
          </span>
          <span className="value">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}
