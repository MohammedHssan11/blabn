# Catalog and recipes

Sold products, ingredients and packaging, their units and conversions, the Foodics names mapped to them, the review queue, and effective-dated recipe versions. Built in Phase 5; see [docs/phase5/CATALOG_AND_RECIPES.md](../../../docs/phase5/CATALOG_AND_RECIPES.md).

- `data.ts` reads the tables with the signed-in person's session and calls the eligibility check. It never writes.
- `actions.ts` are the server actions; each authorizes `recipes.manage` first, then calls one database command that checks it again and audits.
- `forms.ts` holds the pure helpers (exact quantity input, consumption line parsing, error mapping). They are unit tested.
- `ui.tsx`, `item-form.tsx` are shared server-rendered pieces.

Rules that apply here: quantities are exact fractions and are never turned into floating point; a blank is never zero; the database, not the screen, decides whether a line is eligible.
