"""Record Phase 1 outcomes that are not Abdo's page answers.

  # Project owner defers the protected ledger corrections (explicit, dated, with a reason):
  python scripts/phase1/record_outcome.py defer ledger-protected-sheets --by "<project owner>" --reason "<why>" [--until "<phase or date>"]
  # ...or records that they were applied with the sheet password (after apply_fixes.ps1 -SheetPassword):
  python scripts/phase1/record_outcome.py applied ledger-protected-sheets --by "<name>"
  # Team and Abdo agree a final rule after Abdo proposed an alternative or did not accept a team correction:
  python scripts/phase1/record_outcome.py agree P1-29 --rule "<final rule>" --with "Abdo" --date 2026-11-25
  # Abdo confirms the final set of decisions (closure condition), with how he confirmed it:
  python scripts/phase1/record_outcome.py confirm-final --date 2026-11-28 --how "<e.g. reply on the review call>"

Writes docs/phase1/decisions/owner-deferrals.json and docs/phase1/decisions/agreed-outcomes.json.
Then rerun build_corrections_md.py, build_field_map.py and phase1_status.py.
"""
import argparse
import datetime as dt
import json
import os
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEC = os.environ.get("DECISIONS_DIR") or os.path.join(REPO, "docs", "phase1", "decisions")  # DECISIONS_DIR: tests
FIND = {f["id"] for f in json.load(open(os.path.join(REPO, "docs", "phase1", "findings.json"), encoding="utf-8"))["findings"]}


def rw(name, default):
    p = os.path.join(DEC, name)
    return p, (json.load(open(p, encoding="utf-8")) if os.path.exists(p) else default)


ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest="cmd", required=True)
for c in ("defer", "applied"):
    s = sub.add_parser(c)
    s.add_argument("item")
    s.add_argument("--by", required=True)
    s.add_argument("--reason", default="")
    s.add_argument("--until", default="")
s = sub.add_parser("agree")
s.add_argument("finding")
s.add_argument("--rule", required=True)
s.add_argument("--with", dest="with_", required=True)
s.add_argument("--date", default=dt.date.today().isoformat())
s = sub.add_parser("confirm-final")
s.add_argument("--date", required=True)
s.add_argument("--how", required=True)
a = ap.parse_args()
now = dt.datetime.now().isoformat(timespec="seconds")

if a.cmd in ("defer", "applied"):
    p, d = rw("owner-deferrals.json", {"items": {}})
    if a.item not in d["items"]:
        sys.exit(f"unknown item {a.item}; known: {', '.join(d['items'])}")
    if a.cmd == "defer" and not a.reason.strip():
        sys.exit("a deferral needs --reason")
    it = d["items"][a.item]
    it["history"] = it.get("history", []) + [{k: it.get(k) for k in ("status", "by", "on", "reason", "until")}]
    it.update({"status": "deferred" if a.cmd == "defer" else "applied", "by": a.by, "on": now, "reason": a.reason, "until": a.until})
elif a.cmd == "confirm-final":
    p, d = rw("agreed-outcomes.json", {"outcomes": {}})
    d["final_set_confirmed"] = {"by": "Abdo", "date": a.date, "how": a.how, "recorded_at": now}
else:
    if a.finding not in FIND:
        sys.exit(f"unknown finding {a.finding}")
    p, d = rw("agreed-outcomes.json", {"outcomes": {}})
    old = d["outcomes"].get(a.finding)
    d["outcomes"][a.finding] = {"rule": a.rule, "agreed_with": a.with_, "agreed_on": a.date, "recorded_at": now,
                                "history": (old.get("history", []) + [{k: old[k] for k in ("rule", "agreed_with", "agreed_on")}]) if old else []}
json.dump(d, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("recorded in", p)
