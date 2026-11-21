/**
 * Branch settings. Each branch carries its own timezone and business-day
 * rollover time so business dates are derived from the branch, not the server.
 *
 * Accounts, roles and permissions arrive in Phase 3; this module currently only
 * holds the branch model the report prototypes need.
 */
export interface BranchSettings {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  /** IANA timezone, e.g. "Africa/Casablanca". */
  timezone: string;
  /** Local time at which a new business day starts ("00:00" until Phase 4 confirms otherwise). */
  businessDayRollover: string;
  /** True for a branch that closes its days in this application (Maarif). */
  operatesInApp: boolean;
}
