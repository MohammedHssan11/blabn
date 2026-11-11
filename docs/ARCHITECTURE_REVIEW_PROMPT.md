# First-Agent Prompt for Codex or Claude

Copy the complete prompt below into Codex or Claude. It tells the agent exactly how to get the repository, what to read, what to review, and when it is allowed to start implementation.

```text
You are joining an existing private GitHub repository as a senior software architect and implementation partner.

Repository URL: https://github.com/MohammedHssan11/blabn

First, confirm that your GitHub account has access. Then clone and enter the project:

```bash
git clone https://github.com/MohammedHssan11/blabn.git
cd blabn
git status
```

Do not create a Python virtual environment. The current project is a planned TypeScript/Next.js web application; no application dependencies have been installed yet.

Your first task is architecture review only. Understand the entire project and independently decide whether the proposed architecture matches the product goal. Do not implement product code, install packages, create a database project, create a branch, or modify existing documents during this review.

Read these files in this exact order:
1. README.md
2. docs/PROJECT_CONTEXT.md
3. docs/REQUIREMENTS.md
4. docs/DATA_AND_REPORTS.md
5. docs/SOURCE_MATERIAL.md
6. docs/DECISIONS.md
7. docs/ARCHITECTURE.md

Business goal:
- Replace repeated daily Excel data entry with one web workflow for daily closing, Product Mix, inventory, recipes/BOM consumption, replenishment suggestions, and five Excel report families.
- Abdo is the System Admin inside the deployed client application. He is not the repository or GitHub administrator.
- Branch staff work below Abdo with limited permissions.
- Camera attendance is a later phase, using one branch kiosk device. It must not be treated as complete merely because a UI exists.

Current proposal:
- A single Next.js + React + TypeScript web application and installable PWA.
- Server-side business logic in the same application.
- Supabase PostgreSQL for data, authentication, authorization, storage, and migrations.
- Excel import/export through a server-side adapter.
- Modular monolith for the MVP; no desktop application and no early microservices.
- A separate camera-verification service only after the operational core and a real device test.

Important constraints:
- Original Excel workbooks and approved Foodics report images are available in `source-material/` because the private development repository needs them for implementation and validation.
- Do not rename, delete, publish, or copy `source-material/` outside the private repository. Do not commit archive material, credentials, or real employee biometric data.
- Foodics direct integration is not confirmed. Manual entry is required in version one.
- The first replenishment algorithm must be explainable, not an unsupported machine-learning claim.
- Use PostgreSQL-level data integrity and auditability. Do not use the browser as the source of truth for financial or stock calculations.

Create exactly one new file: `docs/ARCHITECTURE_REVIEW.md`.

The file must contain these exact sections:
1. Verdict: APPROVE, APPROVE WITH CHANGES, or CHANGE REQUIRED.
2. Requirement-to-architecture fit: identify every important requirement that is covered, partly covered, or missing.
3. Data model review: organization/branch boundary, business-day close, payments, expenses, Product Mix, stock movements, physical counts, recipes, purchase orders, reports, audit logs, and future attendance events.
4. Security and authorization review: Abdo System Admin, staff roles, Supabase RLS, server-only secrets, audit trails, and biometric-data boundaries.
5. Reliability review: source-of-truth calculations, idempotency for imports/exports, duplicate prevention, daylight/timezone handling, offline strategy, and report reconciliation.
6. Excel/reporting review: how to preserve the five report families without duplicating business data.
7. Attendance review: what must be deferred, and what real-device/liveness/privacy decisions are still missing.
8. A prioritized list of architecture changes, if any, with the smallest viable alternative for each.
9. Recommended implementation order and acceptance tests for the MVP.
10. Open questions that block production release but do not block the first development sprint.

Rules:
- Be concrete. Do not give generic advice.
- Do not invent Foodics fields, recipe quantities, report rules, or employee policies.
- Do not modify code or existing documents during this first review.
- Do not commit or push anything during this first review.
- If changes are needed, propose exact edits or a concise replacement architecture; wait for the project owner to approve changes before editing anything.
- Write the review in English.
- At the end of your response, state: `REVIEW COMPLETE — WAITING FOR APPROVAL TO IMPLEMENT.`
```
