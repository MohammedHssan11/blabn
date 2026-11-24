import "server-only";
import { cache } from "react";
import { createUserClient } from "@/lib/supabase/server";

export const isReportExportOwner = cache(async () => {
  const db = await createUserClient();
  const { data, error } = await db.rpc("app_is_report_export_owner");
  return !error && data === true;
});
