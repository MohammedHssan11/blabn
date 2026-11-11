# Architecture Review Prompt for Codex or Claude

Copy the prompt below into Codex or Claude after cloning this repository.

```text
You are a senior software architect reviewing an early-stage internal operations application for a restaurant branch.

Repository: Balaban Branch Operations

Your task is to understand the entire project and independently review whether the proposed architecture matches the actual product goal. Do not implement product code in this review.

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
- The repository intentionally does not contain Abdo's original workbooks, report photos, audio, credentials, or biometric data. They are local reference material under ignored archive/ and must never be committed.
- Foodics direct integration is not confirmed. Manual entry is required in version one.
- The first replenishment algorithm must be explainable, not an unsupported machine-learning claim.
- Use PostgreSQL-level data integrity and auditability. Do not use the browser as the source of truth for financial or stock calculations.

Return a written review with these exact sections:
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
- If changes are needed, propose exact edits or a concise replacement architecture; wait for approval before editing anything.
- Write the review in English and save it as docs/ARCHITECTURE_REVIEW.md.
```
