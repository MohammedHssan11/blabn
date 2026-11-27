# Attendance (Phases 13–14)

Employee IDs, kiosk devices, face enrollment, verification attempts, attendance events, corrections, worked
time and the attendance Excel report. Design and trust model: [docs/phase13_14/ATTENDANCE.md](../../../docs/phase13_14/ATTENDANCE.md).

| File | Role |
|---|---|
| `hours.ts` | Pure pairing of events into shifts and exact elapsed time (unit-tested with the required examples) |
| `summary.ts` | The one summary the screen and the Excel file both render |
| `workbook.ts`, `export.ts` | The attendance Excel workbook (values only, Arabic right-to-left) |
| `forms.ts` | Form and request validation, reason and error codes |
| `data.ts` | Readers (as the signed-in person; the database checks the permission) |
| `kiosk.ts`, `verifier.ts`, `routes.ts` | Kiosk and enrollment flows: database command → verifier → signed verdict → database command |
| `actions.ts` | Administration server actions (each checks its own permission first) |
| `ui.tsx` | Small view helpers |

Rules that apply here: the browser never decides a verification; durations come from instants and are never
rounded; a blank (no check-out) is never counted as zero; saved values are the same in Arabic and English.
