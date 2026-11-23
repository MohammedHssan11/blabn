# Comparisons

Cross-branch sales comparison (Phase 7, report fields CMP-01 to CMP-08). Design and rules: [docs/phase7/COMPARISON.md](../../../docs/phase7/COMPARISON.md).

- `calc.ts`: pure calculations: weekly (one shared date pair, current ÷ prior), monthly (day-number matching, growth, like-for-like period), coverage, and availability (missing, before the first live date, not started).
- `data.ts` (`server-only`): reads and commands as the signed-in person (`app_comparison_report`, `app_comparison_save`, settings, history).
- `service.ts` (`server-only`): query parsing and the traced view models, from the database or from the Phase 2 demonstration fixtures (`BALABAN_DEMO_FIXTURES=1`).
- `forms.ts`, `actions.ts`: the entry and settings forms.
- `export.ts`: the CSV built from the same view model as the page.
