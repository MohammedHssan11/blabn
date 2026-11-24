import { NextResponse, type NextRequest } from "next/server";
import { authorizeRequest } from "@/modules/access/guard";
import { isCatalogId } from "@/modules/catalog/forms";
import { exportRequirements } from "@/modules/exports/families";
import { downloadExport, readExport, XLSX_TYPE } from "@/modules/exports/service";

/**
 * Download of a completed Excel export. Checked three times against live data: the signed-in person
 * here, then the family's permission for EVERY branch of the export (authorizeRequest), then the
 * database (`app_report_export_download`, which also records the download) and Storage's own policy
 * on the private file. A person who lost the permission gets 403, whoever holds the link.
 */
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const signedIn = await authorizeRequest();
  if (!signedIn.ok) return signedIn.response;
  const { id } = await context.params;
  if (!isCatalogId(id)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  const record = await readExport(id.toLowerCase());
  if (!record || !record.mine || record.status !== "complete") return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const decision = await authorizeRequest(exportRequirements(record.family, record.branches, record.include_drafts));
  if (!decision.ok) return decision.response;

  const result = await downloadExport(record.id);
  if ("error" in result) {
    const status = result.error === "forbidden" ? 403 : result.error === "export_integrity" ? 500 : 404;
    return NextResponse.json({ error: result.error }, { status, headers: NO_STORE });
  }
  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${result.record.file_name}"`,
      "Content-Length": String(result.bytes.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Sha256": result.record.file_sha256 ?? "",
    },
  });
}
