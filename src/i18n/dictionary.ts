import en from "./messages/en.json";
import ar from "./messages/ar.json";
import type { Locale } from "./config";

/** English is the reference: Arabic must provide exactly the same keys (see tests/i18n.test.ts). */
export type Messages = typeof en;

type Join<K extends string, P extends string> = `${K}.${P}`;
type Leaves<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : Join<K, Leaves<T[K]> & string>;
    }[keyof T & string];

export type MessageKey = Leaves<Messages>;

const catalogs: Record<Locale, Messages> = { en, ar };

export function getMessages(locale: Locale): Messages {
  return catalogs[locale];
}

export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

function lookup(messages: unknown, key: string): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node && typeof node === "object" && part in node) node = (node as Record<string, unknown>)[part];
    else throw new Error(`Missing translation key: ${key}`);
  }
  if (typeof node !== "string") throw new Error(`Translation key is not a string: ${key}`);
  return node;
}

export function createTranslator(locale: Locale): Translator {
  const messages = getMessages(locale);
  return (key, params) => {
    const template = lookup(messages, key);
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
  };
}

/** Leaf paths of a catalog, used by tests to compare the two languages. */
export function flattenKeys(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) => flattenKeys(value, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}
