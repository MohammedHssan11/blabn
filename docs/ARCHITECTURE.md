# Architecture

## Architecture choice

Build a single **web application and installable PWA** as a modular monolith. Do not build a separate desktop application or a collection of microservices for the MVP.

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

The attendance camera service is a later, isolated component:

```text
Attendance kiosk -> camera verification service -> attendance events in PostgreSQL
```

## Technology choices

| Area | Choice |
|---|---|
| Main language | TypeScript |
| Web framework | Next.js + React |
| Styling | Tailwind CSS |
| Database | PostgreSQL, managed by Supabase |
| Authentication | Supabase Auth |
| Authorization | Application roles plus PostgreSQL Row Level Security |
| File storage | Supabase Storage |
| Excel layer | Server-side import/export adapter |
| Validation | Zod or equivalent schema validation |
| Unit tests | Vitest |
| End-to-end tests | Playwright |
| Attendance service, later | Isolated camera-verification service only if required after a real device test |

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
- Later: `attendance_devices`, `attendance_events`, `attendance_adjustments`, `face_templates`

## Security rules

- Abdo is the initial System Admin in the deployed client application. Staff can access only the branch data and actions explicitly assigned to their role. Repository and GitHub administration remain with the development team.
- Enable Row Level Security on exposed database tables.
- Never ship a Supabase service-role key to the browser.
- All financial, stock, order, and attendance changes must create an audit log.
- Store each ledger entry and daily-close adjustment as an immutable event with an explicit business date. Derive daily and monthly balances from those events instead of saving editable summary totals.
- A purchase order must store `created_at`, `expected_receipt_date`, and `actual_receipt_date` separately. The initial expected receipt policy is two calendar days after creation; a changed date requires an override reason and audit record.
- Store biometric templates separately from general employee data; avoid storing raw face images unless a later approved policy requires them.
- Keep `.env`, `.env.local`, and production exports out of Git.

## Repository layout

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

