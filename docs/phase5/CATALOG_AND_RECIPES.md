# Phase 5: catalog, Foodics mappings, units and recipes

Phase 5 lets the system answer one question for a business date: **may this sold line be consumed, and exactly what would it consume?** It stores the catalog, the approved Foodics names, the units with their conversions, and effective-dated recipe versions. It does not post stock movements; Phase 6 stores an eligible result as the posting.

Screens (System Admin, permission `recipes.manage`): `/{ar|en}/catalog` (items), `/catalog/review` (review queue and the date question), `/catalog/recipes` (recipes and versions), `/catalog/consumption` (consumption check).

## What is stored

| Record | Purpose |
|---|---|
| `catalog_items` | Sold products (including add-ons), ingredients and packaging. Arabic name required, English name optional (never invented; the screens say when it is missing). Optional code, source section, base, sales, purchase and storage units. Discontinuing keeps the record, its recipes and its names. |
| `catalog_units`, `catalog_item_conversions` | Units belong to a dimension: mass, volume, count or pack. Units of the same dimension convert on their own (kg to g). A pack (carton, crate, sack) or a cross-dimension conversion exists only as an approved per-item conversion with its basis. |
| `catalog_source_labels` | Every original label kept verbatim with its source and cell. A Foodics label becomes usable only when it is **approved** for one item; at most one approved meaning per label. |
| `catalog_review_items` | The review queue. Each entry names the exact source rows. |
| `catalog_date_decisions` | A question only Abdo can answer, which gates the versions that name it. |
| `recipe_versions`, `recipe_lines` | Draft, approved or withdrawn versions per sold product with inclusive effective dates, lines (ingredient or packaging, exact quantity, unit, source row) and an optional confirmed batch yield. |

**Exact quantities.** Recipe quantities and conversions are stored as numerator and denominator, never as floating point. The workbook formulas include `=0.1/3` (1/30 kg) and `=0.25/1.25*0.0594117647`; both are kept exactly. The application shows the decimal rounded to nine places and flags a rounded value (`≈`, with the exact fraction in the tooltip). Matching of names folds hamza, ta marbuta, alef maqsura, diacritics, Arabic-Indic digits and spacing, and nothing else; the original label is always stored beside the key.

## Rules enforced by the database

- **Eligibility.** A sold line is consumable only with an approved Foodics mapping (or the sold item itself), an approved recipe whose dates cover the business date, and every recipe line convertible into its component's base unit. Each blocked line returns reason codes naming the component, line number and source row. Valid lines in the same request proceed.
- **One recipe per product and date.** An exclusion constraint forbids overlapping approved ranges. Approving a later open-ended version ends the earlier one the day before; any other overlap is refused.
- **Recipes never move under history.** An approved version and its lines cannot be changed or deleted by anyone (a trigger, so the table owner is refused too). The only permitted change is closing an open range once. A later version therefore leaves the basis and quantities of an earlier date identical.
- **Approval needs a sound recipe.** Every line needs an ingredient, a positive quantity and a unit that converts. A refused approval changes nothing and writes no audit row.
- **Date gate.** Versions that differ between the October and November workbooks are linked to the question «نسخة وصفات نوفمبر بدأ العمل بيها من يوم كام؟». They cannot be approved until the answer is recorded, and then only on dates that follow it (the November version starts on it, the October version ends the day before).
- **Permissions.** Every change goes through a command that checks `recipes.manage` and writes one audit row in the same transaction. Items, recipes and units are readable by people who hold `recipes.manage` or `inventory.view` (the Storekeeper); mappings, the review queue and the date question only by `recipes.manage`. The eligibility check needs `recipes.manage` or `inventory.view` on the branch. No API role can write a catalog table.
- **Optimistic concurrency.** Item and recipe edits carry the version the person saw; a stale edit is refused with a clear message.

## What is loaded for testing

`npm run catalog:extract` reads the **original** October and November inventory workbooks (SRC-06, SRC-07, sheet `2`) into `fixtures/catalog/legacy-catalog.json`; `npm run seed:catalog` turns it into `supabase/seed_catalog.sql`, which `supabase db reset` loads after the base seed. A test fails if either drifts.

| Loaded | Count |
|---|---|
| Items: ingredients / packaging / sold products | 175 / 116 / 265 (556) |
| Recipe versions (all drafts) / lines | 268 / 1,721 |
| Foodics labels: approved / pending | 2 / 7 |
| Review entries open | 191 (including the date question) |

Linking rule: a recipe line belongs to the Product Mix row its sold-quantity formula reads (`=+F78`, `=$F$119`, or a chain through another recipe row). This is the workbook's own consumption basis. A recipe that reads an empty row, or none, is queued.

### Abdo's confirmed cases (22 November 2026)

| Case | How it appears |
|---|---|
| **P1-28** Dubai chocolate cake | Both Foodics spellings («كبيرة» as recorded and «كبير» as read from the 7 November photo) are approved for the one product that carries the workbook label «كيكة هبة دبى شيكولاتة صغيرة» (SRC-07 sheet `2` D325) and the decision-record label. All four labels are kept. Nothing else is approved. The Kinder cake («كيكة الهبة دبي صوص كيندر كبير» against «… صغيرة») is **not** covered: it stays in the queue with both source rows, and the retained quantity 12 of the 7 November workbook is untouched. |
| **P1-31** mixed nuts | The ten rows written «عدد» (0.04 to 0.07) are kilograms. The numbers are unchanged and the original label is kept in `source_unit_label`. Their queue entry is stored as resolved with the twenty rows of both workbooks. The other 18 conflicting components stay open. |
| **P1-32** spoons and dates | The November large Bazabizo Mango version has six «ملاعق بلاستيك للارز - مستورد» (SRC-07 sheet `2` D1015:G1015); the October version has none. They are separate versions and both stay drafts until the date is answered. |

Everything else is unresolved by design: six other Foodics lines from the 7 November report are proposals awaiting approval; 61 recipes read an empty sales row; 69 components are missing from the inventory list; 90 recipe lines have no quantity (grouped under 18 components, plus entries for written zeros); 18 components carry conflicting units; 9 recipes link to no sales row.

## Verification

| Command | What it covers |
|---|---|
| `npm run db:check:phase5` | `supabase/tests/phase5_checks.sql` (rolls back): access and grants, the three confirmed cases as loaded, exact arithmetic, a known product's hand-calculated consumption including packaging, mapping states, effective-date boundary, history stability, immutability, overlap, blocked-line isolation, damaged units, discontinued records, the date gate on the real recipes, audit. |
| `npm run db:upgrade-test` | Section E upgrades a Phase 4 database, loads the catalog seed, reruns the Phase 2 to 5 checks and compares schema and grants with a fresh build. |
| `npm run test:phase5` | HTTP checks of the real forms: access per role and language, the confirmed cases, the date gate, queue workflows, an independent exact calculation for 24 loaded recipes, a versioned lifecycle, concurrent approvals, permission removal, audit. |
| `npm run test:phase5:browser` | Edge in English and Arabic, desktop and 375 px: direction, no horizontal scroll, the real approval and mapping workflows. |

## Handover to Phase 6

- Store an eligible result as the posting: keep `recipe.id`, each component's `line_id` and the exact `quantity` (numerator, denominator). Never recompute a past posting from the current recipe.
- Before Phase 6 posts, make closing an open recipe range (`catalog_approve_recipe` supersession) refuse a date that already has posted consumption.
- Use the review queue entries listed above as the Phase 6 and Phase 10 work list with Abdo.
