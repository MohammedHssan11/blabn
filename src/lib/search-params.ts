export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of a query parameter. */
export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
