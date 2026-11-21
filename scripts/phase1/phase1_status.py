"""Phase 1 closure checklist: writes docs/phase1/CLOSURE.md and exits 1 while Phase 1 cannot close.

Phase 1 can close only when all of these hold:
  1. every 'required' question has Abdo's recorded answer;
  2. every alternative that is not fully specified by its option (free-text alternatives), and every
     contested team correction, has an agreed final rule (decisions/agreed-outcomes.json);
     "not sure" answers count as unanswered;
  3. the field map has no pending field except ones waiting only for 'later' questions, which
     name their phase and owner;
  4. the protected ledger corrections are applied or explicitly deferred by the project owner;
  5. the workbook checks pass (diff: 0 unexplained; value checks; boundary tests);
  6. Abdo has confirmed the final set and date, or the project owner has scheduled
     that confirmation for Phase 10 acceptance;
  7. the legacy order-sheet date is confirmed or explicitly deferred.
Usage (repo root): python scripts/phase1/phase1_status.py
"""
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
D = os.path.join(REPO, "docs", "phase1")
DECD = os.environ.get("DECISIONS_DIR") or os.path.join(D, "decisions")  # DECISIONS_DIR: tests
j = lambda *p: json.load(open(os.path.join(DECD, *p[1:]) if p[0] == "decisions" else os.path.join(D, *p), encoding="utf-8-sig"))
F = j("findings.json")["findings"]
dec_file = j("decisions", "abdo-decisions.json")
DEC = dec_file.get("decisions", {})
QF = json.load(open(os.path.join(D, "review-questions.json"), encoding="utf-8"))
QMAP = {q["finding"]: q for q in QF["questions"]}


def answered(d):
    """An answer counts only if it is not 'not sure' (unsure stays unresolved)."""
    return bool(d) and d.get("choice") != "unsure"


def needs_rule(x, d):
    """True when the answer still needs a team-agreed final rule (record_outcome.py agree)."""
    if not answered(d):
        return False
    q = QMAP.get(x)
    if not q:  # finding without a page question: anything but 'accept' contests the team's handling
        return d["choice"] != "accept"
    if d["choice"] != "alternative":
        return False  # accept and keep are complete decisions
    o = next((o for o in q["options"] if o["key"] == d.get("option")), None)
    return not (o and o.get("needs_agreement") is False)  # a fully specified alternative needs no extra rule


AG = j("decisions", "agreed-outcomes.json")
AGREED = AG["outcomes"]
OWNER = j("decisions", "owner-deferrals.json")["items"]
FM = j("field-map.json")
VER = j("corrected-verification.json")["summary"]
BT = j("boundary-tests.json")
DIFF = j("corrected-diff.json")
byid = {f["id"]: f for f in F}

req = [f["id"] for f in F if f["abdo"] == "required"]
req_open = [x for x in req if not answered(DEC.get(x))]
unsure = [x for x in req if x in DEC and not answered(DEC[x])]
contested = [x for x, d in DEC.items() if needs_rule(x, d) and x not in AGREED]
fm_block = [f["id"] for f in FM["fields"] if f["status"] == "pending" and
            (f["contested_without_agreed_rule"] or any(byid[x]["abdo"] != "later" for x in f["waiting_for_answer"]))]
fm_later = [f["id"] for f in FM["fields"] if f["status"] == "pending" and f["id"] not in fm_block]
ledger = OWNER["ledger-protected-sheets"]
legacy_order = OWNER.get("legacy-order-sheet-date", {})
legacy_date_confirmed = DEC.get("P1-35", {}).get("option") in ("order_day", "delivery_day") or "P1-35" in AGREED
legacy_date_deferred = legacy_order.get("status") == "deferred" and bool(legacy_order.get("until"))
legacy_date_detail = "confirmed" if legacy_date_confirmed else (
    f"deferred until {legacy_order['until']} by {legacy_order['by']}: {legacy_order['reason']}"
    if legacy_date_deferred else "meaning of SRC-01 Sheet1!C6 still open"
)
unexplained = sum(v.get("changed_cells", {}).get("unexplained", 0) for v in DIFF.values())
checks_ok = unexplained == 0 and VER["passed"] == VER["checks"] and BT["passed"] == BT["total"]
fc = AG.get("final_set_confirmed")
final = f"{fc['by']} on {fc['date']} ({fc['how']})" if fc else None
final_deferral = OWNER.get("final-review-confirmation", {})
final_deferred = final_deferral.get("status") == "deferred" and bool(final_deferral.get("until"))
final_detail = final or (f"deferred until {final_deferral['until']} by {final_deferral['by']}: {final_deferral['reason']}"
                         if final_deferred else "not yet")

items = [
    ("Required questions answered by Abdo", not req_open, f"{len(req) - len(req_open)} of {len(req)}" + (f" — open: {', '.join(req_open)}" if req_open else "") + (f" (not sure: {', '.join(unsure)})" if unsure else "")),
    ("Alternatives that are not fully specified, and contested team corrections, have an agreed final rule", not contested, "none open" if not contested else "open: " + ", ".join(contested)),
    ("Field map complete (pending only on later-phase questions)", not fm_block, f"{FM['summary']['fields']} fields; blocking: {', '.join(fm_block) or 'none'}; waiting for later-phase questions: {', '.join(fm_later) or 'none'}"),
    ("Protected ledger corrections applied or deferred by the project owner", ledger["status"] in ("applied", "deferred"),
     ledger["status"] + (f" by {ledger['by']} on {ledger['on']}: {ledger['reason']}" if ledger["status"] != "pending" else " — record with scripts/phase1/record_outcome.py")),
    ("Workbook checks pass", checks_ok, f"diff unexplained {unexplained}; value checks {VER['passed']}/{VER['checks']}; boundary tests {BT['passed']}/{BT['total']}"),
    ("Final confirmation recorded or scheduled by the project owner", bool(final) or final_deferred, final_detail),
    ("Legacy order-sheet date confirmed or explicitly deferred", legacy_date_confirmed or legacy_date_deferred, legacy_date_detail),
]
can_close = all(ok for _, ok, _ in items)
later = [f for f in F if f["abdo"] == "later"]
L = ["# Phase 1 closure checklist", "",
     "Generated by `scripts/phase1/phase1_status.py`. Rerun after importing Abdo's answers or recording an outcome.", "",
     f"**Phase 1: {'can close' if can_close else 'OPEN'}.**", "",
     "| Condition | Met | Detail |", "|---|---|---|"]
L += [f"| {n} | {'yes' if ok else '**no**'} | {d} |" for n, ok, d in items]
L += ["", "## Questions for later phases (do not block Phase 1)", "", "| Finding | Needed before | Answered |", "|---|---|---|"]
L += [f"| {f['id']} | {f['abdo_by']} | {'yes' if answered(DEC.get(f['id'])) else 'no'} |" for f in later]
L.append("")
open(os.path.join(D, "CLOSURE.md"), "w", encoding="utf-8").write("\n".join(L))
for n, ok, d in items:
    print(("OK   " if ok else "OPEN ") + n + " — " + d)
print("Phase 1 can close" if can_close else "Phase 1 stays open")
sys.exit(0 if can_close else 1)
