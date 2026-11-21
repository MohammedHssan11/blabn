# Balaban Branch Operations

An internal Arabic and English application for the Maarif branch. It replaces repetitive daily Excel entry with one operating workflow for daily closing, product mix, inventory, replenishment suggestions, cross-branch sales comparison, and reports. The web release comes first, followed by a separately installable desktop application and then camera attendance.

## Current status

Phase 1 closed on 21 November 2026 after the source audit, six recorded answers and workbook checks. Phase 2 has the [report contracts](docs/phase2/REPORT_CONTRACTS.md), a bilingual Next.js application with three prototypes on synthetic data, and Supabase migrations; its acceptance checks passed on 21 November 2026 (see the handover record). See the [closure checklist](docs/phase1/CLOSURE.md) and [handover record](docs/HANDOFF.md) for the three scheduled follow-ups.

Phase 3 local acceptance is complete. It adds sign-in, password recovery, staff accounts, permission groups, branch isolation and an append-only audit history. See [accounts and permissions](docs/phase3/ACCOUNTS_AND_PERMISSIONS.md) and the [handover record](docs/HANDOFF.md) for verification and production setup.

The bilingual interface uses B.Laban’s blue and white palette across sign-in, the workspace, and operational screens. See the [brand references](docs/BRAND_DESIGN.md).

## Product scope

- Enter a business day once: sales, orders, cash, card/Visa, expenses, bank remittance, and counted cash.
- Calculate order average, card ratio, expected cash, and cash variance.
- Record Product Mix sales and turn them into recipe/BOM consumption.
- Track stock, receipts, waste, hospitality, physical counts, and variances.
- Generate a transparent replenishment suggestion for the correct receipt day. A purchase order created on Wednesday evening, for example, is planned for Friday delivery, not Thursday.
- Plan replenishment over three months with same-weekday comparisons, so a Wednesday can be reviewed against earlier Wednesdays rather than an unrelated day.
- Compare sales for Al Quds, Maarif, Bourgogne, and their total. Al Quds and Bourgogne figures are entered by authorized users for reporting only.
- Export the five existing report families to Excel.
- Work in Arabic and English, with the same figures in both languages.
- Add a separately installable desktop application after the web release is verified in live use.
- Add camera-based attendance on a dedicated branch device after the desktop release.

## Access model

- **Abdo is the initial system administrator of the deployed client application.** He owns the branch configuration, users, roles, recipes, reports, and approvals. This is an application role only; it does not grant repository or GitHub administration.
- **Staff are subordinate users.** Their access is limited to the tasks assigned to them, such as daily closing, stock counting, or attendance.
- The initial build supports one branch, but the data model keeps an organization/branch boundary for future expansion.

## Active documentation

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Project context](docs/PROJECT_CONTEXT.md)
- [Requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Architecture review](docs/ARCHITECTURE_REVIEW.md)
- [Data and reports](docs/DATA_AND_REPORTS.md)
- [Decisions and backlog](docs/DECISIONS.md)
- [Source-material map](docs/SOURCE_MATERIAL.md)
- [Onboarding prompt for Claude or Codex](docs/ARCHITECTURE_REVIEW_PROMPT.md)
- [Phase 1 source review and Abdo's review page](docs/phase1/README.md)
- [Handover record](docs/HANDOFF.md)

## Repository rules

- Keep source code, migrations, tests, English documentation, and the approved private source material in Git.
- `source-material/` contains Abdo's original Excel workbooks and approved report images. It is included because the development team needs it to build and validate the application.
- Keep the repository private. Do **not** commit credentials, employee face data, raw biometric templates, or unrelated production exports.
- Work on a feature branch, open a pull request, and merge only after review.
- Keep `main` runnable at all times.

## Implementation order

Delivery follows the 15 phases in the [Implementation Plan](docs/IMPLEMENTATION_PLAN.md), starting with the Phase 1 review of every source workbook with Abdo. Each phase closes, after its acceptance checks pass, before the next phase starts.
