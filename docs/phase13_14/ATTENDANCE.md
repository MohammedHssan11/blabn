# Phases 13–14 — Camera attendance

Employee IDs, kiosk devices, face enrollment, live verification at the kiosk, worked time, corrections and the attendance Excel export. Built locally on 26 November 2026 on branch `codex/phase-13-14-attendance` (from `main` at `dd33208`). This is a **blocked review branch, not ready for merge or deployment**. Phases 11 and 12 were deferred by the owner.

Status, test evidence and open items are in [the handover record](../HANDOFF.md#phases-1314-status). This document describes the design.

## 1. What Abdo and the employees see

| Who | Where | What |
|---|---|---|
| Abdo (System Admin) | **Attendance** (`/attendance`) | Period totals per employee, every shift (check-in, check-out, duration, status), unsuccessful and refused attempts, Excel in Arabic or English. |
| | **Attendance employees** (`/attendance/employees`) | Add a person: type the name and the next **three-digit ID (101–999)** is given at once; the page goes straight to face enrollment with the number shown large ("رقمك 107"). Register an existing staff member (a three-digit staff number is kept; any other is replaced). IDs never change and are never reused. |
| | **Employee page** (`/attendance/employees/<id>`) | Rename (attendance-only people), activate/deactivate with a reason, enroll / re-enroll / delete the face reference, shifts and events for a period, correct an event (change its time or cancel it) or add a missing event, each with a reason. |
| | **Enrollment** (`/attendance/employees/<id>/enroll`) | With the employee present: record which identity document was checked and the employee's consent, then the camera captures a look straight, left and right. |
| | **Attendance devices** (`/attendance/devices`) | Register a kiosk account as a device, deactivate or reactivate it. |
| Employee | **Kiosk** (`/kiosk`, on the kiosk laptop) | Type the ID on the on-screen keypad (or keyboard) — the camera warms up while typing and switches off after 20 s without a key — press **حضور** or **انصراف**, follow two big animated arrows inside a face oval, read the green confirmation with the first name and time (back to the keypad after 3 s) or one short reason plus a tip such as "turn your head further". |

Arabic and English throughout; the kiosk is laid out for the HP laptop screen (1366 × 768) and hides the menu and sign-out link.

## 1a. Interface update (26 November 2026, after the trial)

Decided with the owner: IDs 101–999; Abdo enters each person himself and enrolls them on the spot; two kiosk buttons; the camera warms up while the ID is typed; attendance first, then the rest of the site.

* **Kiosk**: two columns on the laptop (camera on one side, keypad and buttons on the other), stacked on narrow screens. Mirror preview with a dashed face oval; one large animated arrow per turn and two progress circles that tick when each timed step ends (a progress display, not a verdict). Capture shortened from 5.6 s to 2.9 s (0.8 s straight, 1.5 s per turn, 0.3 s end; about 15 frames at the page’s capture rate, 8–40 accepted). Measured from the button press to the confirmation in the browser test: **4.7 s** with the synthetic test engine (8–9 s before). With the real engine add roughly 1 s of verification time; this was not re-measured on the real camera.
* **Hints**: the verifier attaches one advice code to a failure — turn further, follow the arrows, come closer, more light, one person only — from aggregate numbers (turn size, face size, mean brightness). The kiosk and the enrollment page show it under the reason. Advice only: no decision depends on it.
* **Enrollment**: the new number is shown large; same oval and arrows; a capture whose turns were too small is repeated once automatically.
* **Attendance home**: four cards (checked in now, missing check-outs to correct with a link to the employee, today, the period), quick links, Excel buttons; the full tables follow.
* **Menu**: the kiosk entry is shown only to kiosk accounts (not to the people who administer attendance).
* **Site-wide design pass** (CSS only, no logic): sticky header, accent-marked section headings, softer cards, readable tables (row hover, sticky header row, tabular figures, total rows), clear focus and hover states on inputs and buttons, phone spacing.
* Migration `20261130090000_attendance_ids_and_hints.sql` (forward-only): `attendance_next_code` gives one more than the highest three-digit ID ever used (never reusing a leaver's number) and refuses with `employee_ids_exhausted` after 999; registration keeps only a fitting staff number; the kiosk view returns the advice code. Employees registered under `20261129090000` keep their existing IDs (upgrade path M).

## 2. Verification approach

### Decision

**One-to-one face verification with a random head-movement challenge, decided by an isolated server-side verifier**, using two OpenCV Zoo models run by OpenCV's DNN module in Python:

* **YuNet** (2023-03, MIT) finds the face and five landmarks (eyes, nose tip, mouth corners);
* **SFace** (2021-12, Apache-2.0) turns an aligned face into a 128-number embedding; similarity is the cosine of two embeddings.

The employee types an ID, so the system compares the live face with **that one employee's** reference only. There is no search across employees.

### Why this approach

| Option | Outcome |
|---|---|
| Face matching in the browser (JavaScript models) | Rejected: the browser is untrusted; its verdict could be forged. The browser may only capture frames. |
| A cloud face API | Not used: it sends biometric data to an outside provider and needs a paid account. Both need the owner's agreement first. |
| ONNX Runtime inside the Next.js server | Possible, but adds a ~300 MB native package (a new download and dependency) and keeps the template key in the web server. Kept as an alternative. |
| **Isolated Python verifier (chosen)** | OpenCV, NumPy and `cryptography` were already installed; the two models were already present in `tmp/` and **their SHA-256 values match the official OpenCV Zoo files exactly** (checked against the Hugging Face LFS ids, without downloading). It keeps the template key out of the web server and the database, matching the "isolated camera-verification service" planned in [ARCHITECTURE.md](../ARCHITECTURE.md). |
| `tmp/attendance-models/antispoof.onnx` | **Not used.** Its origin, licence and training could not be verified; it matches no published hash I could find. |
| The `tmp/attendance-venv` environment | Not used; the verifier runs on the system Python (requirements pinned in `services/attendance-verifier/requirements.txt`). |

### What "live" means here, and what it does not

**Independent review, 27 November 2026 — release blocker:** The verifier accepts an identical synthetic frame sequence for two distinct attempts with different nonces when the challenge repeats. The HMAC binds the verdict, not the capture to the attempt. This is documented as an expected-failure security regression in `services/attendance-verifier/tests/test_replay_security.py`; it is not an effective replay defense. No real-person footage was used in that regression. Do not treat the feature as release-ready until a suitable defense and the outstanding real-camera attack tests have passed the agreed criteria.

A verification passes only when all of these hold for the 8–40 frames of this one attempt ([`decide.py`](../../services/attendance-verifier/verifier/decide.py), [`geometry.py`](../../services/attendance-verifier/verifier/geometry.py)):

1. no frame shows a second person; at most 40 % of frames lack a face;
2. the first frames face the camera (the baseline);
3. **exactly the two movements** the database issued for this attempt — a left turn and a right turn in a cryptographically random order (2 possible sequences) — **in order**, each held for at least two frames. The verifier can also judge "look up", but the database no longer issues it: in the real-camera trial a deliberate upward tilt (largest reading 0.03–0.09) did not separate from the noise of plain turns (up to 0.115) against its 0.10 threshold;
4. each movement shows **3-D parallax**: the nose moves differently from where a flat (affine) motion of the eyes and mouth would put it. A printed photo or a phone screen that is turned, tilted or moved stays flat;
5. the face does not jump or change size abruptly between frames;
6. the baseline frames match the enrolled reference (cosine ≥ 0.363, OpenCV's published SFace threshold) and **every** frame still resembles it (≥ 0.28), so a photo of the employee cannot be swapped for another person's live face mid-capture.

**What it does not establish** (state these plainly to the owner):

* **A replayed video of the employee** performing the right movements — on a phone held to the camera or injected as a virtual camera — contains real 3-D motion and can pass, if the attacker has a recording of the two turns in the right order (only 2 possibilities). The 90-second expiry and the random order make this harder, not impossible. **Not tested with a real phone video.**
* **Virtual cameras and injected feeds**: a normal Windows laptop cannot prove that the frames came from its own camera. Anyone who controls the kiosk laptop's browser can send any frames.
* **Masks, a very similar-looking person, twins**: not evaluated.
* **No passive presentation-attack detection** (screen, paper texture, moiré): not included, because no model with verifiable provenance was available. Adding one is the main improvement to evaluate next.

These limits are why the trial below records attack results instead of assuming them.

## 3. Trust model and the flow of one check-in

```text
Kiosk browser ──(ID, action)──▶ web server ──▶ PostgreSQL: app_attendance_attempt_start
       ◀── random challenge, attempt id ──┘        (device, branch, employee, rate limit, state;
       camera on, frames captured                   nonce + challenge + 90 s expiry)
       ──(frames)──▶ web server ──▶ PostgreSQL: app_attendance_attempt_material (own pending attempt only)
                              ──▶ verifier: decides, signs HMAC(attempt, nonce, employee, reference,
                                            action, challenge, outcome, engine, time, key id)
                              ──▶ PostgreSQL: app_attendance_attempt_complete
                                   verifies the HMAC, locks employee + attempt, re-checks everything,
                                   writes ONE event at the database clock, audit row
       ◀── "Check-in recorded at 09:05:23" ──┘
```

* **The browser never reports an outcome.** The only thing it can report is a failure before verification (camera refused/stopped, cancelled, connection lost), which can never create an event.
* **The web server cannot create an event either**: it does not hold the HMAC key. The kiosk's own Supabase session (which a person at the laptop could extract from the browser) can start attempts and read its own attempt's encrypted reference, but cannot forge a verdict.
* **Binding**: the signed message names the attempt id, its random 128-bit nonce, the employee, the face reference, the action and the challenge. A verdict cannot be used for another attempt, employee, action or later event (tested).
* **Single use**: an attempt moves once from *pending* to its outcome (trigger-enforced). Repeated or concurrent completions return the first result.
* **Expiry**: 90 seconds; the verdict's issue time must fall inside the attempt's life (±5 s).
* **Idempotency**: the kiosk sends a request key per button press; a double press or a retry is the same attempt. A retry after success returns the same event.
* **Lock order** (employee, then attempt) everywhere, so concurrent requests cannot deadlock (tested over 20 racing rounds).
* **Brute-force brake**: 5 failed verifications for one ID within 15 minutes pause that ID (a security control; the numbers are adjustable and should be confirmed by the owner).
* **Device**: a kiosk is a staff account holding **only** the Attendance Kiosk group at its branch, registered on the devices page. Every kiosk command re-checks the device, the account, the permission and least privilege; an account given any other right is refused until fixed. Deactivating the device or disabling its account stops it on the next request and fails its pending attempts.
* **Isolation**: the kiosk can read nothing — no attendance, financial, stock, comparison, report or audit row (tested at the database, HTTP and browser levels).

## 4. Biometric data: where, who, how long

| Question | Answer |
|---|---|
| What is stored | One **face reference** per employee: the mean of the normalised SFace embeddings (128 numbers) of the frontal enrollment frames, **encrypted with AES-256-GCM by the verifier**. The associated data binds it to the employee and reference id. No photo, video or frame is stored anywhere. |
| Where | `app_private.attendance_face_references` (PostgreSQL, not exposed by the Data API; no API role, not even the service role, has any privilege on it). The decryption key exists only in the verifier's environment. |
| Who can use it | Only the verifier can decrypt. The kiosk command hands the ciphertext of **its own pending attempt's** reference to the web server, which forwards it to the verifier. Administrators see only the status, date, enroller and the type of identity document checked. |
| Enrollment | Only a person holding `attendance.enroll` for the branch (Abdo), with the employee present, after recording which identity document was checked (not its number) and the employee's consent. The enrollment itself must pass the movement and parallax checks, so a photo cannot be enrolled. |
| Replacement | Re-enrollment replaces the reference and **erases the old ciphertext** in the same transaction. |
| Deletion | "Delete face reference" (reason required) erases the ciphertext and cancels pending attempts. Audited. |
| Deactivation | Deactivating an employee blocks attendance at once but **keeps** the reference until it is deleted. Retention after an employee leaves is **an owner decision** (see open items). |
| Physical erasure | PostgreSQL keeps old row versions until vacuum, and backups keep what they captured. Erasure from backups follows the backup retention. |
| Metadata kept per attempt | Status, reason, entered ID, device, time and aggregate numbers (match score, lowest frame score, parallax, frame counts, thresholds, engine). Arrays are dropped by the database. |
| Logs | The verifier logs one line per request (path, status, outcome code, duration). The web server logs nothing attendance-specific. Checked by the automated tests. |
| Outside providers | None. |
| Legal | Biometric processing in Morocco is regulated (Law 09-08; the CNDP requires prior authorisation for biometric processing). **The owner must confirm compliance before real employees are enrolled.** This is not legal advice. |

## 5. Worked time

Implemented in [`hours.ts`](../../src/modules/attendance/hours.ts) and [`summary.ts`](../../src/modules/attendance/summary.ts); the screen and the Excel file render the same summary.

* Events store the **database clock, truncated to the second**; durations are exact differences of instants in whole seconds. Nothing is rounded.
* Per employee in time order: check-in → check-out = **complete** shift; a check-in followed by another check-in or nothing = **no check-out recorded** (listed, never counted); a check-out with no open check-in = **check-out without check-in** (listed).
* Shifts crossing midnight or a clock change are exact (instants, not wall-clock arithmetic). 22:00 → 06:00 = 8:00:00.
* **No breaks, rounding, lateness, overtime or payroll rules.**
* **Reporting period (provisional — owner question 1):** a shift counts on the local date of its check-in (Africa/Casablanca, from PostgreSQL). The reader also returns each employee's last event before and first event after the period, so boundary shifts pair exactly.
* **Kiosk state rule (owner question 2):** a check-in while a shift is open is refused and shows the current state ("checked in since …"); nothing is recorded. If yesterday's check-out was forgotten, a manager adds it before the employee can check in.

## 6. Corrections

`app_attendance_correct` (permission `attendance.correct`): **add** a missing event, **cancel** an event, or **change its time** (cancel + replacement event). A reason is required; the corrected time is typed as branch-local time and converted by PostgreSQL; it cannot be in the future. The original event is never changed or deleted (append-only triggers for every role); the screen shows it crossed out with the correction (kind, person, time, reason), the Excel file lists it on the Exceptions sheet, and the audit history records the original values. One correction per event; a resubmitted form is the same correction.

## 7. Permissions

| Permission | Purpose | Holder |
|---|---|---|
| `attendance.view` | Screens, shifts, attempts | System Admin |
| `attendance.employees.manage` | Add/register/rename, activate/deactivate | System Admin |
| `attendance.enroll` | Enroll, re-enroll, delete face references | System Admin |
| `attendance.devices.manage` | Register/activate/deactivate kiosks | System Admin |
| `attendance.correct` | Corrections | System Admin |
| `attendance.export` | Attendance Excel — **separate from** `reports.export` and `comparison.export` | System Admin |
| `attendance.event.create` (existing) | The kiosk | Attendance Kiosk group |

No other group receives attendance access until the owner decides.

## 8. Database

Migrations [`20261129090000_attendance.sql`](../../supabase/migrations/20261129090000_attendance.sql) and [`20261130090000_attendance_ids_and_hints.sql`](../../supabase/migrations/20261130090000_attendance_ids_and_hints.sql), forward-only, after the merged head `20261128090000`.

* Public, RLS on, read-only to `authenticated` through policies, no write grant to any API role (not even `service_role`): `attendance_employees`, `attendance_devices`, `attendance_attempts` (column grant hides the nonce), `attendance_events`, `attendance_corrections`.
* Private: `app_private.attendance_signing_keys`, `attendance_config` (synthetic-engine switch, off), `attendance_enrollments`, `attendance_face_references`.
* Commands (`app_attendance_*`, SECURITY DEFINER, `search_path = ''`, execute for `authenticated` only) check the caller's live permission for the branch and write the audit row in the same transaction.
* The employee ID of a person registered for attendance cannot change (trigger), also through the staff page.

**Deployment prerequisites (when the owner decides — not done):**

1. Review and apply the migration (`npx supabase db push --linked --dry-run` first; never `--include-seed`).
2. Host the verifier next to the web server (same machine or private network with TLS), with the two pinned model files and its environment (README).
3. Generate the template key(s) and the result key; insert the result key into `app_private.attendance_signing_keys` with psql; set `ATTENDANCE_VERIFIER_URL` and `ATTENDANCE_VERIFIER_TOKEN` on the web server. Keep `allow_synthetic_engine` false.
4. Create the kiosk staff account (Attendance Kiosk group only), register it as a device, sign in on the kiosk laptop.
5. Settle the legal and owner questions below before enrolling real employees.

## 9. Acceptance criteria

| # | Criterion | How measured |
|---|---|---|
| 1 | Required worked-time examples (09:05–17:10 = 8:05:00; 22:00–06:00 = 8:00:00; incomplete not counted; retry = one event; correction changes the result and keeps the original; Excel = screen) | unit tests, SQL checks, HTTP e2e, browser |
| 2 | No success without the verifier's valid signature; no replay, cross-employee reuse, edited, stale, future or retired-key verdict | SQL checks §6, e2e §4–6 |
| 3 | Concurrency: one event per attempt; no deadlock; unique IDs; one correction per request | concurrency test |
| 4 | Kiosk least privilege and tenant/branch isolation | SQL §3–4, §11; e2e §2; browser |
| 5 | Deactivation of employee/device and deletion of the reference take effect at once | SQL §8; e2e §6 |
| 6 | No biometric data in logs, tables readable by the API, files or Git | SQL §1, e2e §8, architecture tests, `git status` |
| 7 | Camera refused/missing/stopped, connection lost, verifier down: clear message, nothing recorded | browser §4–5, e2e §6 |
| 8 | **Real camera: the enrolled person succeeds** in normal kiosk conditions | trial: **6 of 6** left/right attempts succeeded (small sample, one person) |
| 9 | **Real camera: another person with the ID, a printed photo and a phone photo fail** | trial: **not done** (one attempt had a phone photo and a second person in view together; refused as "more than one face", which tests neither alone) |
| 10 | **Real camera: a replayed phone video** — result recorded honestly; not claimed as defeated | trial: **not done** |
| 11 | Operational thresholds (time to verify, false-rejection rate) set from the trial | partly: time measured (8 s); no impostor scores, so the match threshold stays at OpenCV's published value |

Criteria 1–7 pass (automated). Criterion 8 passes on a small sample. Criteria 9–11 remain open (section 10).

## 10. Real-camera trial (26 November 2026)

**Setup.** This HP laptop and its HP Wide Vision HD camera, indoor room light, Edge, the production build, the real verifier (YuNet + SFace, pinned hashes, synthetic engine refused) and a disposable database (`balaban-p1314`). One participant, the project owner, enrolled as "Trial participant" (no real name stored). Attempts were made by the owner at the kiosk; the scenario of each attempt is what the owner reported. Only the aggregate numbers below were kept; at the end the face reference was erased, the disposable database reset and the local trial account file deleted. No frame or image was saved.

**Enrollment.** Four tries: the first three were refused because the turns were too small; the fourth succeeded. Detailed measurements for the individual participant are kept in a private local review copy, not in the public repository.

**Verification attempts (left/right challenge).**

| Reported condition | Result |
|---|---|
| Normal, closer, farther or off to one side | Six successes for one participant |
| Phone photo **and** a second person in view | Refused: more than one face; neither attack was tested alone |

Verifier processing 1.2–1.6 s per attempt; the rest is the 5.6 s capture.

**"Look up" challenge.** Four attempts with an "up" step failed. It was removed from the issued challenges and the turn instruction now says "about a quarter turn".

**Findings.** Six genuine attempts succeeded with left/right. Small turns caused enrollment refusals. Removing "up" leaves only two challenge orders, so the challenge adds little against a prepared video. These few attempts cannot establish accuracy or attack resistance.

**Not done (remain blockers for criteria 9–11):** another person alone with the ID; a phone photo alone; a printed photo; a phone video; the deliberately wrong movement on the real camera (covered by automated tests only); glasses; lighting changes; real camera unplugged/disabled mid-check (covered by browser tests with a simulated camera). No impostor scores exist yet, so no false-acceptance figure can be stated.

## 11. Open owner decisions

1. **Reporting period of an overnight shift**: check-in date (current, provisional), business day with the 02:00 rollover, or split at midnight?
2. **Forgotten check-out**: refuse the next check-in until a manager corrects it (current), or record the new check-in and flag the old shift?
3. **Retention of face references** after an employee leaves or is deactivated (delete at once, after N days, or keep).
4. **Brute-force brake**: 5 failures / 15 minutes per ID (current) — keep?
5. **Who else may view, correct or export attendance** (today only Abdo).
6. **Legal basis and CNDP authorisation** for biometric attendance; employee information notice.
7. **Thresholds** after the trial; whether to evaluate a passive anti-spoofing model, and from which source.
8. **Hosting of the verifier** in production (Phase 11 hosting is undecided).
