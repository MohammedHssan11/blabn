# Daily closing

Business days, close figures, cash movements and cash counts.

- `calc.ts` – pure server-side calculations (daily figures, month totals, expected cash, reconciliation at count time).
- `service.ts` – `server-only`; builds the traced view models the pages render.
- `types.ts` – saved-record types. `null` is a blank value, `0` a recorded zero.

Phase 2 serves synthetic fixtures through `src/lib/repository.ts`; Phase 4 replaces them with Supabase-backed commands.
