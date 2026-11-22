# Daily closing

The daily close starts with sales, orders and payments and links the physical count, ledger entries, cancellations and report views.

- `operations.ts` reads the operating-day reports with the signed-in person's Supabase session.
- `operation-actions.ts` authorizes writes and calls the database command. The corresponding SQL migration validates, revises, posts and audits each write atomically.
- `operation-workspace.tsx` and `operation-forms.tsx` render the live bilingual views.
- `service.ts`, `calc.ts` and `types.ts` retain the Phase 2 reference and demo behavior.

See the [Phase 4 workflow](../../../docs/phase4/OPERATING_CLOSE.md).
