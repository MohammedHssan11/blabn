# Source Material Map

## Purpose

This document describes the branch material received from Abdo. The approved original Excel workbooks and report photographs are included in this private repository because the development team needs them to build and validate the system. The repository must remain private.

## Where the original files are stored

```text
source-material/
├─ workbooks/        # Fourteen Excel reference workbooks (originals, unchanged)
├─ corrected/        # Phase 1 corrected copies (see docs/phase1/CORRECTIONS.md)
└─ images/
   └─ 2026-11-07/    # Three Foodics report photographs and one transcription summary
```

## Workbook inventory

| Source ID | Description | Period | Intended use |
|---|---|---|---|
| SRC-01 | Replenishment order workbook | November 2026 | Order layout, items, units, and quantities. |
| SRC-02 | Daily Sales workbook | October 2026 | Daily revenue, orders, average, cash, expenses, and card values. |
| SRC-03 | Daily Sales workbook | November 2026 | Same report family for a later period. |
| SRC-04 | Daily statement workbook | October 2026 | Financial statement layout and daily values. |
| SRC-05 | Daily statement workbook | November 2026 | Same report family for a later period. |
| SRC-06 | Inventory workbook | October 2026 | Product Mix, stock rows, physical counts, and recipe/BOM formulas. |
| SRC-07 | Inventory workbook | November 2026 | Same inventory report family for a later period. |
| SRC-08 | Sales comparison workbook | October 2026 | Day-by-day period comparison. |
| SRC-09 | Sales comparison workbook | November 2026 | Day-by-day period comparison. |
| SRC-10 | Daily ledger workbook | October 2026 | Daily cash and purchasing-custody ledgers, cash counts, cancellations, and monthly summary layout. |
| SRC-11 | Daily ledger workbook | November 2026 | Same report family for a later period. |
| SRC-12 | `مقارنه يوميه المغرب (3) (1).xlsx` | November 2026 example | One worksheet comparing current and prior weeks for three branches, including Maarif, with an aggregate section. Reference for the comparison layout. |
| SRC-13 | `inventory-nov-2026-days-1-13.xlsx` | November 2026 (1-13) | Newer copy of SRC-07 with inventory and Product Mix for 1-13 November (added 19 Nov 2026, Phase 1 finding P1-01). |
| SRC-14 | `inventory-review-template-nov-2026.xlsx` | November 2026 | Abdo's inventory-review template: opening balances, daily receipts, consumption (added 19 Nov 2026). |

## Image inventory

| Source ID | Date | Description | Verified value |
|---|---|---|---|
| IMG-01 | 2026-11-07 | Foodics Orders Summary | Net sales 100,605 MAD; 1,185 orders; cash 55,105 MAD; card 45,500 MAD. |
| IMG-02 | 2026-11-07 | Product Mix, upper section | Part of the Product Mix report. |
| IMG-03 | 2026-11-07 | Product Mix, lower section | Completes the same Product Mix report. |
| IMG-04 | 2026-11-07 | Manual transcription summary | Reference-only transcription of the photographed reports. |

## Local material reviewed in Phase 1 (not in Git)

The Phase 1 audit also reviewed material that exists only on the development computer. It is listed here so findings can cite it. LOC-01 and LOC-02 were added to `source-material/workbooks/` as SRC-13 and SRC-14 on 19 November 2026 (P1-01). The full per-sheet inventory is in [Phase 1 source coverage](phase1/SOURCE_COVERAGE.md).

| Source ID | Local location | Description | Status |
|---|---|---|---|
| LOC-01 | `abdo temp/شيت جرد بلبن فرع المعاريف نوفمبر 2026 (2).xlsx` | Newer copy of SRC-07 with inventory and Product Mix for 1-13 November | Abdo's file; days 1-2 identical to SRC-07 |
| LOC-02 | `abdo temp/مراجعه الجرد.xlsx` | Inventory-review template (opening balances, daily receipts, consumption) | Abdo's file |
| LOC-03, LOC-04 | `outputs/01a1d811-…/مراجعة … .xlsx` | Filled copies of LOC-02 | Produced by an earlier assistant; derived, not evidence |
| LOC-05 | `abdo temp/WhatsApp Video 2026-11-14 at 6.00.01 AM.mp4` | Screen recording explaining LOC-02 | Personal recording; keep local |
| LOC-06, LOC-07 | `outputs/…/*.png`, `outputs/ABDO_REVIEW_2026-11-14.md` | Earlier assistant renders and review notes | Leads only |

## Rules for the development team

- Keep the repository private; the source material contains real operational data.
- Do not add `archive/` to Git or upload its contents to GitHub.
- Do not alter original workbooks or report images. Corrections go into `source-material/corrected/` with a change log ([Phase 1 corrections](phase1/CORRECTIONS.md)).
- Do not treat an empty spreadsheet value as a confirmed zero.
- Use anonymized fixtures in `sample-data/` for automated tests.
- Real reference days may be entered by hand only in a private test environment restricted to the project team. Never commit them as fixtures or store original files in application storage. Omit or mask customer contact details from cancellation records.
- A Codex or Claude agent with repository access can inspect `source-material/` read-only. It must not rename, delete, edit, publish, or copy the material outside the private repository without explicit approval.

## Current availability

The development team can use the documentation and source files to understand the workflow. See SRC-10 and SRC-11 for the daily-ledger layout and SRC-12 for the weekly comparison layout. Validate one real branch day against the agreed templates before production report sign-off.
