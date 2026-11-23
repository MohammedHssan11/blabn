# Replenishment

Three-month same-weekday planning, purchase orders and receiving (Phase 8). Design, rules and commands: [docs/phase8/REPLENISHMENT.md](../../../docs/phase8/REPLENISHMENT.md).

- `planning.ts`: the planning arithmetic as exact, pure functions (unit-tested in `tests/replenishment.test.ts`).
- `verify.ts`: recomputes a database plan with `planning.ts`; the pages flag any difference.
- `forms.ts`: form parsing and error mapping (pure).
- `data.ts`: reads and the one write path (`app_purchase_order_command`), as the signed-in person.
- `actions.ts`: server actions; each authorizes with the permission its command needs.
- `ui.tsx`, `types.ts`: rendering helpers and the database result shapes.

Order creation, expected receipt and actual receipt are separate dates; the legacy order-sheet date is the expected receipt (P1-35). PostgreSQL is the authority for the business date, the plan and every stored quantity. A blank (NULL) is never treated as zero.
