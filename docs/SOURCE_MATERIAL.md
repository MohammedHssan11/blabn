# Source Material Map

## Purpose

This document describes the branch material received from Abdo. The approved original Excel workbooks and report photographs are included in this private repository because the development team needs them to build and validate the system. The repository must remain private.

## Where the original files are stored

```text
source-material/
├─ workbooks/        # Eleven original Excel workbooks plus one added Arabic-named monthly daily-ledger workbook
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
| SRC-10 | Daily ledger workbook | October 2026 | Expenses, cash counting, revenue, and card entries. |
| SRC-11 | Daily ledger workbook | November 2026 | Same report family for a later period. |
| SRC-12 | `مقارنه يوميه المغرب (3) (1).xlsx` | Not confirmed | Monthly daily-ledger reference: 31 daily sheets, ledger and purchasing-custody balances, cash counts, cancellation records, and monthly summaries. |

## Image inventory

| Source ID | Date | Description | Verified value |
|---|---|---|---|
| IMG-01 | 2026-11-07 | Foodics Orders Summary | Net sales 100,605 MAD; 1,185 orders; cash 55,105 MAD; card 45,500 MAD. |
| IMG-02 | 2026-11-07 | Product Mix, upper section | Part of the Product Mix report. |
| IMG-03 | 2026-11-07 | Product Mix, lower section | Completes the same Product Mix report. |
| IMG-04 | 2026-11-07 | Manual transcription summary | Reference-only transcription of the photographed reports. |

## Rules for the development team

- Keep the repository private; the source material contains real operational data.
- Do not add `archive/` to Git or upload its contents to GitHub.
- Do not alter original workbooks or report images.
- Do not treat an empty spreadsheet value as a confirmed zero.
- Use anonymized fixtures in `sample-data/` for automated tests.
- A Codex or Claude agent with repository access can inspect `source-material/` read-only. It must not rename, delete, edit, publish, or copy the material outside the private repository without explicit approval.

## Current availability

The development team can start the application from the English documentation and the source material immediately. The added SRC-12 workbook confirms that the daily-ledger workflow must preserve daily balance roll-forwards, counted cash, cancellation detail, and a separate purchasing-custody ledger. Before production report sign-off, validate one real branch day against the approved workbook templates.
