// Shared rules for Abdo's answers: used by the local server and the import script.
// The review page carries its own copy of merge() (it runs in the browser); keep them identical.
//
// A decision is { choice, option?, extras?, comment, saved_at, history[] }:
//   choice  accept | alternative | keep | unsure   (generic stance; "unsure" stays unresolved)
//   option  the specific answer on the question (key from docs/phase1/review-questions.json)
//   extras  optional extra answers, e.g. { counted_daily: "yes" }
// The page shows only the current required questions, but answers for any finding id are still
// accepted and kept, so nothing saved earlier is lost.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CHOICES = new Set(["accept", "alternative", "keep", "unsure"]);

export function loadRules(repo) {
  const findings = JSON.parse(readFileSync(join(repo, "docs", "phase1", "findings.json"), "utf8"));
  const qfile = JSON.parse(readFileSync(join(repo, "docs", "phase1", "review-questions.json"), "utf8"));
  const questions = new Map([...qfile.questions, ...(qfile.retired_questions || [])].map((q) => [q.finding, q]));
  return { findings, qfile, questions, ids: new Set(findings.findings.map((f) => f.id)) };
}

function cleanEntry(e) {
  const out = { choice: e.choice, comment: String(e.comment || ""), saved_at: e.saved_at };
  if (e.option) out.option = e.option;
  if (e.extras && Object.keys(e.extras).length) out.extras = e.extras;
  return out;
}

export function validateDecision(id, d, rules) {
  if (!rules.ids.has(id)) throw new Error(`unknown finding ${id}`);
  if (!d || !CHOICES.has(d.choice)) throw new Error(`${id}: unknown choice ${d && d.choice}`);
  if (typeof d.saved_at !== "string") throw new Error(`${id}: missing saved_at`);
  const comment = String(d.comment || "");
  const q = rules.questions.get(id);
  if (d.option !== undefined && d.option !== null && d.option !== "") {
    if (!q) throw new Error(`${id}: this finding has no question options`);
    const opt = q.options.find((o) => o.key === d.option);
    if (!opt) throw new Error(`${id}: unknown option ${d.option}`);
    if (opt.maps_to !== d.choice) throw new Error(`${id}: option ${d.option} belongs to choice ${opt.maps_to}, not ${d.choice}`);
    if (opt.needs_text && !comment.trim()) throw new Error(`${id}: this answer needs a description`);
  } else if (d.choice === "alternative" && !comment.trim()) {
    throw new Error(`${id}: alternative needs a description`);
  }
  let extras;
  if (d.extras && typeof d.extras === "object") {
    extras = {};
    for (const [k, v] of Object.entries(d.extras)) {
      const ex = q && q.extras.find((x) => x.key === k);
      if (!ex) throw new Error(`${id}: unknown extra answer ${k}`);
      if (!ex.options.some((o) => o.key === v)) throw new Error(`${id}: unknown value ${v} for ${k}`);
      extras[k] = v;
    }
  }
  const history = Array.isArray(d.history) ? d.history.filter((h) => h && CHOICES.has(h.choice) && typeof h.saved_at === "string").map(cleanEntry) : [];
  return { ...cleanEntry({ ...d, extras, comment }), history };
}

const sig = (h) => h.saved_at + "|" + h.choice + "|" + (h.option || "");

// Per finding keep the most recently saved answer; every older answer goes into its history.
export function merge(a = {}, b = {}) {
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id], y = b[id];
    if (!x || !y) { out[id] = x || y; continue; }
    const [newer, older] = x.saved_at >= y.saved_at ? [x, y] : [y, x];
    const hist = [...(newer.history || [])];
    const seen = new Set(hist.map(sig));
    for (const h of [...(older.history || []), cleanEntry(older)]) {
      if (h.saved_at !== newer.saved_at && !seen.has(sig(h))) { hist.push(h); seen.add(sig(h)); }
    }
    hist.sort((p, q) => (p.saved_at < q.saved_at ? -1 : 1));
    out[id] = { ...cleanEntry(newer), history: hist };
  }
  return out;
}

// An answer counts as given unless it is "not sure".
export const isAnswered = (d) => !!d && d.choice !== "unsure";
