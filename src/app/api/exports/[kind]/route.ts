import { NextResponse, type NextRequest } from "next/server";
import { toDecimalString } from "@/lib/money";
import { getRepository } from "@/lib/repository";
import { ALL_BRANCH_CODES, OPERATING_BRANCH_CODE } from "@/modules/access/catalog";
import { authorizeRequest, type Requirement } from "@/modules/access/guard";

/**
 * Protected downloads. These are minimal CSV exports of the synthetic prototype data, built so
 * the shared authorization path (the same `authorize` that guards pages and actions) is exercised
 * by a real download. The five report families arrive in Phase 9 and will use the same guard.
 *
 *   /api/exports/daily-close-draft?branch=maarif   needs daily_close.export_draft for that branch
 *   /api/exports/comparison                        needs comparison.export for EVERY branch it covers
 *
 * Nothing is read or built before the permission check passes.
 */

const csvCell = (value: string | number | null): string => {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function csvResponse(name: string, header: string[], rows: Array<Array<string | number | null>>): NextResponse {
  const body = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  // A byte-order mark lets Excel read Arabic text correctly.
  return new NextResponse(`﻿${body}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ kind: string }> }) {
  const { kind } = await context.params;

  if (kind === "daily-close-draft") {
    const branch = request.nextUrl.searchParams.get("branch") ?? OPERATING_BRANCH_CODE;
    const requirement: Requirement = { permission: "daily_close.export_draft", branch };
    const decision = await authorizeRequest(requirement);
    if (!decision.ok) return decision.response;
    // Only the operating branch has daily-close data.
    if (branch !== OPERATING_BRANCH_CODE) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const days = await getRepository().listBusinessDays(branch);
    return csvResponse(
      `daily-close-draft-${branch}.csv`,
      ["branch", "business_date", "status", "net_sales_mad", "order_count", "card_mad", "data_source"],
      days.map((day) => [
        day.branchCode,
        day.businessDate,
        day.status,
        day.netSales === null ? null : toDecimalString(day.netSales),
        day.orderCount,
        day.cardAmount === null ? null : toDecimalString(day.cardAmount),
        "synthetic-fixtures",
      ]),
    );
  }

  if (kind === "comparison") {
    const requirements: Requirement[] = ALL_BRANCH_CODES.map((branch) => ({ permission: "comparison.export", branch }));
    const decision = await authorizeRequest(requirements);
    if (!decision.ok) return decision.response;

    const repository = getRepository();
    const [days, figures] = await Promise.all([repository.listBusinessDays(), repository.listComparisonFigures()]);
    const rows = [
      ...days
        .filter((day) => day.status === "closed" && day.netSales !== null)
        .map((day) => [day.branchCode, day.businessDate, toDecimalString(day.netSales ?? 0), day.orderCount, "closed_day"] as Array<string | number | null>),
      ...figures
        .filter((figure) => figure.netSales !== null)
        .map((figure) => [figure.branchCode, figure.businessDate, toDecimalString(figure.netSales ?? 0), figure.orderCount, figure.source] as Array<string | number | null>),
    ].sort((a, b) => String(a[1]).localeCompare(String(b[1])) || String(a[0]).localeCompare(String(b[0])));
    return csvResponse("comparison-figures.csv", ["branch", "business_date", "net_sales_mad", "order_count", "source"], rows);
  }

  // Unknown download names are not a way to probe: check sign-in first so anonymous callers learn nothing.
  const decision = await authorizeRequest();
  if (!decision.ok) return decision.response;
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
