import "server-only";
import { createUserClient } from "@/lib/supabase/server";
import { OPERATING_BRANCH_CODE } from "@/modules/access/catalog";

export const DENOMINATIONS = [20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;
export const ENTRY_KINDS = ["cash_receipt", "cash_expense", "remittance", "custody_receipt", "custody_expense"] as const;
export const SHIFTS = ["morning", "evening", "both"] as const;
export type EntryKind = typeof ENTRY_KINDS[number];
export type Shift = typeof SHIFTS[number];
export type DayState = "draft" | "awaiting_review" | "closed" | "corrected";
export type Command = "save" | "entry" | "count" | "cancel_order" | "submit" | "close" | "return" |
  "late_remittance" | "propose" | "approve" | "reject" | "reverse_entry" | "reverse_cancellation";
export type Change = "save" | "entry" | "count" | "cancel_order" | "reverse_entry" | "reverse_cancellation";

export interface Person {
  id: string;
  name: string;
  role: "cashier" | "manager";
}

export interface CashEntry {
  id: string;
  kind: EntryKind;
  amount: number;
  local: string;
  account: string | null;
  reference: string | null;
  note: string;
  reversedBy?: string;
}

export interface Cancellation {
  id: string;
  original: string;
  originalAmount: number;
  originalLocal: string;
  replacement: string | null;
  replacementAmount: number | null;
  local: string;
  note: string;
  reversedBy?: string;
}

export interface PhysicalCount {
  counter: Person;
  recorder: string;
  recorderName: string;
  local: string;
  total: number;
  quantities: Record<string, number>;
}

export interface OperatingData {
  sales?: number | null;
  morning?: number | null;
  evening?: number | null;
  posCash?: number | null;
  card?: number | null;
  orders?: number | null;
  cashier?: Person | null;
  count?: PhysicalCount | null;
  shift?: Shift | "";
  notes?: string;
  entries: CashEntry[];
  cancellations: Cancellation[];
}

export interface OperatingSummary {
  openingCash: number;
  closingCash: number | null;
  openingCustody: number;
  closingCustody: number;
  expenses: number;
  receipts: number;
  remittances: number;
  custodyReceipts: number;
  custodyExpenses: number;
  expected: number | null;
  variance: number | null;
  statementTotal: number | null;
  average: number | null;
  cardRatio: number | null;
  remittanceRatio: number | null;
}

interface HistoryEntry {
  revision: number;
  basis: number;
  actor: string;
  command: Command;
  reason: string | null;
  sourceRevision: number | null;
  local: string;
}

interface OperatingDay {
  revision: number;
  state: DayState;
  closedLocal: string | null;
  closedAt: string | null;
  data: OperatingData;
  summary: OperatingSummary;
  history: HistoryEntry[];
  proposal: { change: Change; reason: string; data: OperatingData; summary: OperatingSummary } | null;
}

export interface OperatingReport {
  basis: number;
  hasDays: boolean;
  branch: { today: string; local: string; timezone: string; cutoff: string; nameAr: string; nameEn: string };
  days: Array<{ date: string; state: DayState; sales: number | null; orders: number | null; card: number | null; summary: OperatingSummary }>;
  day: OperatingDay | null;
}

export const usesDemoFixtures = () => process.env.BALABAN_DEMO_FIXTURES === "1";

export class ReportBasisNotFound extends Error {}

export async function readOperatingReport(date: string | null, month: string | null, basis: number | null = null): Promise<OperatingReport> {
  const client = await createUserClient();
  const result = await client.rpc("app_operating_report", {
    p_branch: OPERATING_BRANCH_CODE,
    p_date: date,
    p_month: month ? `${month}-01` : null,
    p_basis: basis,
  });
  if (result.error?.code === "P0002") throw new ReportBasisNotFound();
  if (result.error) throw new Error(`Daily close read failed (${result.error.code}).`);
  return result.data as OperatingReport;
}

export async function readOperatingPeople(): Promise<Person[]> {
  const client = await createUserClient();
  const result = await client.rpc("app_operating_directory", { p_branch: OPERATING_BRANCH_CODE });
  if (result.error) throw new Error(`Daily close directory failed (${result.error.code}).`);
  return result.data as Person[];
}
export interface OperatingAccount {
  id: string;
  ledger: "cash" | "custody";
  code: string;
  label: string;
  active: boolean;
}

export async function readOperatingAccounts(): Promise<OperatingAccount[]> {
  const client = await createUserClient();
  const result = await client.from("operating_accounts").select("id, ledger, code, label, active, branches!inner(code)")
    .eq("branches.code", OPERATING_BRANCH_CODE).order("ledger").order("code");
  if (result.error) throw new Error(`Ledger account read failed (${result.error.code}).`);
  return result.data as OperatingAccount[];
}
