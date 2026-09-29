/**
 * Business flows: built-in templates for everyday operations (finance, sales, IT, customer
 * service) that run end to end as soon as they are created. They are told apart by their
 * template `category`, so a new one needs only a category listed here.
 */
import type { TemplateRow } from "~/admin/types";

export const BUSINESS_AREAS: Readonly<Record<string, string>> = {
  finance: "Finance",
  sales: "Sales",
  it: "IT operations",
  "customer-service": "Customer service",
};

export function businessArea(t: Pick<TemplateRow, "category" | "builtIn">): string | undefined {
  return t.builtIn ? BUSINESS_AREAS[t.category] : undefined;
}

/** Business flows first (in the server's order), then everything else. */
export function splitBusinessFlows<T extends Pick<TemplateRow, "category" | "builtIn">>(
  rows: readonly T[],
): { business: T[]; other: T[] } {
  const business = rows.filter((t) => businessArea(t) !== undefined);
  return { business, other: rows.filter((t) => businessArea(t) === undefined) };
}
