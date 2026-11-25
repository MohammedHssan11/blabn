import type { FractionJson, IncomingBucket, ObservationStatus, ReviewReason } from "./planning";

/** Shapes returned by the Phase 8 database functions (see 20261125090000_phase8_replenishment.sql). */

export interface ObservationsJson {
  weekday: number;
  dates: Array<{ date: string; status: ObservationStatus; demand: FractionJson | null }>;
  complete: number;
  missing: number;
  before_live: number;
  total: FractionJson | null;
  average: FractionJson | null;
  sufficient: boolean;
  forecast: FractionJson | null;
}

export interface BridgeJson {
  date: string;
  weekday: number;
  incoming: FractionJson;
  opening: FractionJson;
  consumption: FractionJson | null;
  basis: "posted" | "forecast" | "forecast_remaining" | "unavailable";
  observations: ObservationsJson;
  closing: FractionJson;
}

export interface IncomingJson {
  order: string;
  order_no: number;
  line: string;
  line_no: number;
  source: "factory" | "store";
  expected: string;
  original_expected: string;
  overridden: boolean;
  outstanding: FractionJson;
  bucket: IncomingBucket;
}

export interface PlanWarning {
  code: "bridge_unavailable" | "coverage_exceeds_shelf_life" | "after_cutoff";
  date?: string;
  shelf_life_days?: number;
  cutoff?: string;
}

export interface ItemPlanJson {
  item_id: string;
  name_ar: string;
  name_en: string | null;
  kind: "ingredient" | "packaging";
  base_unit: string;
  status: "recommend" | "review";
  review_reasons: ReviewReason[];
  source: "factory" | "store" | null;
  lead_days: number;
  lead_rule: "two_day_rule" | "source_setting";
  order_date: string;
  expected: string;
  default_expected: string;
  window_end: string;
  today_posted: boolean;
  on_hand: FractionJson;
  coverage: Array<{ date: string; observations: ObservationsJson }>;
  bridge: BridgeJson[];
  usable: FractionJson;
  incoming: IncomingJson[];
  eligible_incoming: FractionJson;
  forecast: FractionJson | null;
  /** Safety stock for the coverage period; null in review. Lines saved before 20261127090000 hold a fixed quantity. */
  safety: FractionJson | null;
  /** The branch percentage the safety stock was taken from (absent on lines saved before it existed). */
  safety_percent?: number | string;
  /** Phase 8 plans only: a per-item quantity was set. */
  safety_set?: boolean;
  raw: FractionJson | null;
  recommended: FractionJson | null;
  constraints: Array<{ code: "supplier_minimum" | "pack_size"; value: FractionJson; pack?: FractionJson; packs?: number }>;
  suggested: FractionJson | null;
  settings: { pack: FractionJson | null; min_order: FractionJson | null; shelf_life_days: number | null; cutoff: string | null; revision: number | null };
  warnings: PlanWarning[];
  history: ObservationsJson[] | null;
}

export interface PlanJson {
  branch: string;
  order_date: string;
  now_local: string;
  rollover: string;
  timezone: string;
  expected: string | null;
  default_expected: string;
  coverage_days: number;
  min_observations: number | null;
  live_from: string | null;
  window_from: string;
  window_to: string;
  complete_dates: string[];
  items: ItemPlanJson[];
}

export type OrderStatus = "proposed" | "approved" | "rejected" | "historical";

export interface OrderLineJson {
  id: string;
  line_no: number;
  item_id: string;
  name_ar: string;
  name_en: string | null;
  source: "factory" | "store";
  unit: string;
  quantity: string;
  final: FractionJson;
  base_unit: string;
  final_base: FractionJson;
  suggested: FractionJson | null;
  override_reason: string | null;
  plan: ItemPlanJson | null;
  received: FractionJson;
  cancelled: FractionJson;
  outstanding: FractionJson;
  cancellations: Array<{ quantity: FractionJson; reason: string; actor: string; at: string; local: string }>;
}

export interface OrderJson {
  id: string;
  order_no: number;
  origin: "app" | "legacy";
  status: OrderStatus;
  business_date: string | null;
  created_at: string | null;
  created_local: string | null;
  created_by: string;
  decided_by: string | null;
  decided_at: string | null;
  /** Branch-local "YYYY-MM-DDTHH:MI" computed by PostgreSQL (the time-zone authority). */
  decided_local: string | null;
  decision_note: string | null;
  note: string | null;
  source_file: string | null;
  source_cell: string | null;
  original_expected: { date: string; kind: "default" | "legacy"; rule: string | null; source_value: string | null } | null;
  expected: { date: string; kind: "default" | "override" | "legacy"; revision: number; reason: string | null } | null;
  receipt_dates: string[];
  lines_count: number;
  open_lines: number;
  lines?: OrderLineJson[];
  dates?: Array<{ revision: number; date: string; kind: string; rule: string | null; reason: string | null; source_value: string | null; actor: string; at: string; local: string }>;
  receipts?: Array<{ id: string; business_date: string; local: string; reference: string | null; note: string | null; actor: string; posting: string;
    lines: Array<{ line: string; quantity: string; movement: string; over_receipt_reason: string | null }> }>;
  events?: Array<{ command: string; actor: string; business_date: string; at: string; local: string; reason: string | null }>;
  today?: string;
  local?: string;
}

export interface SettingsJson {
  branch: string;
  min_observations: number | null;
  coverage_days: number;
  revision: number;
  safety_percent: number | string;
  live_from: string | null;
  sources: Array<{ source: "factory" | "store"; lead_days: number | null; cutoff: string | null; revision: number }>;
  items: Array<{ item_id: string; name_ar: string; name_en: string | null; base_unit: string; safety: FractionJson | null; pack: FractionJson | null;
    min_order: FractionJson | null; shelf_life_days: number | null; source: "factory" | "store" | null; revision: number }>;
}
