# Balaban Branch Operations

An internal web application for the Maarif branch. It replaces repetitive daily Excel entry with one operating workflow for daily closing, product mix, inventory, replenishment suggestions, reports, and later attendance.

## Current status

Planning and repository setup. No production code has been started yet.

## Product scope

- Enter a business day once: sales, orders, cash, card/Visa, expenses, bank remittance, and counted cash.
- Calculate order average, card ratio, expected cash, and cash variance.
- Record Product Mix sales and turn them into recipe/BOM consumption.
- Track stock, receipts, waste, hospitality, physical counts, and variances.
- Generate a transparent replenishment suggestion for the next day.
- Export the five existing report families to Excel.
- Add camera-based attendance on a dedicated branch device in a later phase.

## Access model

- **Abdo is the initial system administrator of the deployed client application.** He owns the branch configuration, users, roles, recipes, reports, and approvals. This is an application role only; it does not grant repository or GitHub administration.
- **Staff are subordinate users.** Their access is limited to the tasks assigned to them, such as daily closing, stock counting, or attendance.
- The initial build supports one branch, but the data model keeps an organization/branch boundary for future expansion.

## Active documentation

- [Project context](docs/PROJECT_CONTEXT.md)
- [Requirements](docs/REQUIREMENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data and reports](docs/DATA_AND_REPORTS.md)
- [Decisions and backlog](docs/DECISIONS.md)
- [Source-material map](docs/SOURCE_MATERIAL.md)
- [Architecture review prompt](docs/ARCHITECTURE_REVIEW_PROMPT.md)

## Repository rules

- Keep source code, migrations, tests, and English documentation in Git.
- Do **not** commit credentials, production exports, employee face data, raw voice notes, original workbooks, or archived material.
- Work on a feature branch, open a pull request, and merge only after review.
- Keep `main` runnable at all times.

## First implementation order

1. Create the database schema and access roles.
2. Build daily closing and cash reconciliation.
3. Add Product Mix, inventory movements, and recipes.
4. Produce the five Excel report exports and compare them with a real branch day.
5. Add replenishment suggestions.
6. Add the camera attendance module after the operational core is stable.
