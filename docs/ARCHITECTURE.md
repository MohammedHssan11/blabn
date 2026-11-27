# Architecture

## Architecture choice

Build a single **web application and installable PWA** as a modular monolith. Deliver the web application first. After it passes live verification, build a separately installable desktop application that uses the same backend, accounts, permissions, and server-side calculations. Do not split the system into microservices.

```text
Laptop / tablet / phone
          |
          v
Next.js web application (React + TypeScript)
          |
          v
Server-side business logic and API routes
          |
     +----+-------------------+
     |                        |
     v                        v
Supabase PostgreSQL      Supabase Storage
data, auth, roles        imports and exports
```

The desktop application is a later client of the same backend:

```text
Desktop application (packaging selected in Phase 12) -> same server-side logic, Supabase data, and auth
```

The attendance camera service is an isolated component (built in Phases 13–14, see [phase13_14/ATTENDANCE.md](phase13_14/ATTENDANCE.md)):

```text
Kiosk browser (frames only) -> Next.js route -> attendance verifier (Python, OpenCV YuNet + SFace)
                                     |                  | HMAC-signed verdict
                                     v                  v
                              PostgreSQL commands verify the signature, then write one attendance event
```

The verifier alone holds the face-reference encryption key; the database holds the verdict-signing key; the web server holds neither, so neither it nor the kiosk browser can record attendance without a genuine verdict.

## Technology choices

| Area | Choice |
|---|---|
| Main language | TypeScript |
| Web framework | Next.js + React |
| Styling | Tailwind CSS |
| Localization | Arabic and English with shared translation files and RTL/LTR layout support (library selected in Phase 2) |
| Database | PostgreSQL, managed by Supabase |
| Authentication | Supabase Auth |
| Authorization | Application roles plus PostgreSQL Row Level Security |
| File storage | Supabase Storage |
| Excel layer | Server-side import/export adapter |
| Validation | Zod or equivalent schema validation |
| Unit tests | Vitest |
| End-to-end tests | Playwright |
| Desktop application, later | Separately installable client of the same backend; packaging selected in Phase 12 after the target operating systems are confirmed |
| Attendance verifier | Isolated Python service (OpenCV DNN with the YuNet and SFace models, pinned by SHA-256); see `services/attendance-verifier` |

## Why PostgreSQL

The application has relational and transactional data: products, recipes, ingredients, stock movements, business days, reports, users, and approvals. PostgreSQL is a better fit than a document-first database for joins, constraints, calculations, audit history, and report queries.

## Data boundaries

Every record belongs to an organization and branch. Version one has one branch, but these boundaries prevent a future migration when more branches are added.

Core entities:

- `organizations`, `branches`, `profiles`, `user_roles`, `employees`
- `business_days`, `daily_closings`, `payment_summaries`, `expenses`, `bank_remittances`, `cash_counts`, `cash_count_lines`, `cash_reconciliations`
- `cash_ledger_entries`, `purchasing_custody_entries`, `order_cancellations`
- `products`, `product_mix_lines`, `units`, `inventory_items`, `inventory_movements`, `inventory_counts`
- `recipes`, `recipe_lines`, `purchase_orders`, `purchase_order_lines`, `demand_plans`, `demand_plan_lines`
- `report_exports`, `import_jobs`, `audit_logs`
- Attendance (Phases 13–14): `attendance_employees`, `attendance_devices`, `attendance_attempts`, `attendance_events`, `attendance_corrections`; private `app_private.attendance_enrollments`, `attendance_face_references`, `attendance_signing_keys`

## Security rules

- Abdo is the initial System Admin in the deployed client application. Staff can access only the branch data and actions explicitly assigned to their role. Repository and GitHub administration remain with the development team.
- Enable Row Level Security on exposed database tables.
- Never ship a Supabase service-role key to the browser.
- All financial, stock, order, and attendance changes must create an audit log.
- Store each ledger entry and daily-close adjustment as an immutable event with an explicit business date. Derive daily and monthly balances from those events instead of saving editable summary totals.
- A purchase order must store `created_at`, `expected_receipt_date`, and `actual_receipt_date` separately. The initial expected receipt policy is two calendar days after creation; a changed date requires an override reason and audit record.
- Store biometric templates separately from general employee data; avoid storing raw face images unless a later approved policy requires them.
- Keep `.env`, `.env.local`, and production exports out of Git.

## Planned repository layout

The repository currently contains documentation, reference material, and placeholder directories. The tree below shows the planned application layout.

```text
.
├─ docs/
├─ src/
│  ├─ app/
│  ├─ components/
│  ├─ modules/
│  └─ lib/
├─ supabase/
│  └─ migrations/
├─ scripts/
├─ tests/
├─ sample-data/
├─ .env.example
├─ .gitignore
└─ README.md
```

## Replenishment planning service

The server calculates a three-month same-weekday planning series from approved sales/consumption and stock data. It returns historical comparison rows and a proposed quantity, but it does not turn a forecast into a stock movement or an approved order.

When an authorized user creates an order, server-side logic assigns the expected receipt date using the initial two-calendar-day policy. For example, a Wednesday-evening order receives a Friday expected receipt date. The API must keep the calculation input, default date, override (if any), and actual receipt separate so reports remain auditable.

