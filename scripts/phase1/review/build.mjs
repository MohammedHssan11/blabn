// Builds the self-contained review page for Abdo from docs/phase1/findings.json
// and writes a readable English/Arabic findings register for the team.
//
//   node scripts/phase1/review/build.mjs
//
// Output:
//   docs/phase1/review/abdo-review.html   (the currently required questions; open by double-click, or via review-server.mjs)
//   docs/phase1/review/abdo-review-trial.html (trial copy for Abdo's device; answers never enter the record)
//   docs/phase1/FINDINGS.md                (generated register; do not edit by hand)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const findingsPath = join(repo, "docs", "phase1", "findings.json");
const data = JSON.parse(readFileSync(findingsPath, "utf8"));

// Basic validation so a broken findings file never reaches Abdo.
const required = ["id", "area", "severity", "kind", "title_ar", "locations", "now_ar", "problem_ar", "evidence_ar",
  "impact_ar", "proposal_ar", "why_ar", "verify_ar", "keep_means_ar", "verification_en"];
const ids = new Set();
for (const f of data.findings) {
  for (const k of required) if (!f[k] || (Array.isArray(f[k]) && !f[k].length)) throw new Error(`${f.id}: missing ${k}`);
  if (ids.has(f.id)) throw new Error(`duplicate id ${f.id}`);
  ids.add(f.id);
  if (!data.areas[f.area] || !data.kinds[f.kind] || !data.severities[f.severity]) throw new Error(`${f.id}: unknown area/kind/severity`);
  if (!data.statuses?.[f.status]) throw new Error(`${f.id}: missing or unknown status`);
  if (f.abdo && !data.abdo_levels?.[f.abdo]) throw new Error(`${f.id}: unknown abdo level`);
  if (f.abdo && !f.question_ar) throw new Error(`${f.id}: a question for Abdo needs question_ar`);
  if (f.status !== "decision" && !f.resolution_ar) throw new Error(`${f.id}: needs resolution_ar (what the team did)`);
  if (f.status === "partial" && !f.remaining_en) throw new Error(`${f.id}: partial correction needs remaining_en`);
}

// ---- Abdo's page: the required questions (customer wording in review-questions.json) ----
const qfile = JSON.parse(readFileSync(join(repo, "docs", "phase1", "review-questions.json"), "utf8"));
const requiredIds = data.findings.filter((f) => f.abdo === "required").map((f) => f.id).sort();
const qids = qfile.questions.map((q) => q.finding).sort();
if (JSON.stringify(requiredIds) !== JSON.stringify(qids)) throw new Error(`review-questions.json must hold exactly the required findings: ${requiredIds.join(", ")} (has ${qids.join(", ")})`);
const STANDARD = new Set(["أوافق على المقترح", "أقترح تعديلًا آخر", "نُبقي الوضع الحالي", "مش متأكد / محتاج أراجع"]);
const MAPS = new Set(["accept", "alternative", "keep", "unsure"]);
// Customer wording must be plain: no finding IDs, source IDs, code, JSON or formula chains.
const FORBIDDEN = [/P1-\d+/, /\b(SRC|LOC|IMG)-\d+/, /json/i, /[{}]/, /=\s*[A-Z]{1,3}\d/, /\b(IF|SUM|SUMIFS|ISNUMBER|ROUND|COUNT|VLOOKUP)\(/i, /disposition|owner_approved|status/i];
function lint(where, text) {
  for (const re of FORBIDDEN) if (re.test(text)) throw new Error(`${where}: technical wording (${re}) in "${text.slice(0, 60)}"`);
}
qfile.questions.forEach((q, i) => {
  const w = `question ${q.n} (${q.finding})`;
  if (q.n !== i + 1) throw new Error(`${w}: numbering must be 1..${qfile.questions.length} in order`);
  for (const k of ["title_ar", "ask_ar", "text_prompt_ar"]) if (!q[k]) throw new Error(`${w}: missing ${k}`);
  for (const k of ["where", "now_ar", "why_ar", "proposal_ar", "options", "checks"]) if (!Array.isArray(q[k]) || !q[k].length) throw new Error(`${w}: missing ${k}`);
  if (!q.where.every((x) => x.file_ar && x.tab_ar)) throw new Error(`${w}: every location needs a file and a tab`);
  const keys = new Set();
  for (const o of q.options) {
    if (keys.has(o.key)) throw new Error(`${w}: duplicate option ${o.key}`);
    keys.add(o.key);
    if (!MAPS.has(o.maps_to)) throw new Error(`${w}: option ${o.key} has bad maps_to`);
    if (!STANDARD.has(o.label_ar)) throw new Error(`${w}: option ${o.key} must use one of the four standard labels`);
    if (!o.detail_ar || !o.en) throw new Error(`${w}: option ${o.key} needs detail_ar and en`);
    if (o.maps_to === "alternative" && o.needs_text === undefined && o.needs_agreement !== false) throw new Error(`${w}: alternative ${o.key} must require text unless it is fully specified (needs_agreement: false)`);
  }
  const by = (m) => q.options.filter((o) => o.maps_to === m);
  if (by("unsure").length !== 1) throw new Error(`${w}: needs exactly one "not sure" option`);
  if (!by("accept").length || !by("alternative").length || !by("keep").length) throw new Error(`${w}: needs accept, alternative and keep options`);
  if (!by("alternative").some((o) => o.needs_text)) throw new Error(`${w}: an alternative that requires a description is needed`);
  const texts = [q.title_ar, q.ask_ar, q.text_prompt_ar, ...q.now_ar, ...q.why_ar, ...q.proposal_ar,
    ...(q.example ? [q.example.before_ar, q.example.after_ar] : []),
    ...(q.table ? [...q.table.headers_ar, ...q.table.rows_ar.flat()] : []),
    ...q.where.flatMap((x) => [x.file_ar, x.tab_ar, ...x.cells.map((c) => c.ar)]),
    ...q.options.flatMap((o) => [o.label_ar, o.detail_ar]),
    ...(q.extras || []).flatMap((x) => [x.ask_ar, ...x.options.map((o) => o.label_ar)])];
  texts.forEach((t) => lint(w, t));
});
qfile.usage_ar.forEach((t) => lint("usage", t));
if (qfile.usage_ar.length !== 3) throw new Error("the usage guide must have exactly three steps");
const pageData = {
  questions_version: qfile.questions_version, findings_version: data.version, usage_ar: qfile.usage_ar,
  questions: qfile.questions.map((q) => ({
    n: q.n, finding: q.finding, title_ar: q.title_ar, where: q.where.map((x) => ({ file_ar: x.file_ar, tab_ar: x.tab_ar, cells: x.cells })),
    now_ar: q.now_ar, why_ar: q.why_ar, proposal_ar: q.proposal_ar, example: q.example, table: q.table, ask_ar: q.ask_ar, text_prompt_ar: q.text_prompt_ar,
    options: q.options.map((o) => ({ key: o.key, maps_to: o.maps_to, label_ar: o.label_ar, detail_ar: o.detail_ar, needs_text: !!o.needs_text })),
    extras: q.extras || [],
  })),
};
const template = readFileSync(join(repo, "scripts", "phase1", "review", "template.html"), "utf8");
const json = JSON.stringify(pageData).replace(/</g, "\\u003c");
if (!template.includes("/*QUESTIONS_JSON*/") || !template.includes("/*TRIAL*/false")) throw new Error("template lost a placeholder");
const page = template.replace("/*QUESTIONS_JSON*/", () => json);
const outDir = join(repo, "docs", "phase1", "review");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "abdo-review.html"), page, "utf8");
// Trial copy for testing on Abdo's device: separate storage, no server, answers file marked "trial".
const trial = template.replace("/*TRIAL*/false", "/*TRIAL*/true").replace("<title>", "<title>تجربة — ").replace("/*QUESTIONS_JSON*/", () => json);
writeFileSync(join(outDir, "abdo-review-trial.html"), trial, "utf8");

// Findings register (markdown) for the development team.
const lines = [];
lines.push("# Phase 1 findings register");
lines.push("");
lines.push(`Generated from [findings.json](findings.json) (version \`${data.version}\`) by \`scripts/phase1/review/build.mjs\`. Do not edit by hand.`);
lines.push("");
lines.push(`Abdo's [review page](review/abdo-review.html) shows only the ${qfile.questions.length} findings marked **Required** (customer wording in [review-questions.json](review-questions.json)); each can be accepted, changed, kept as is, or marked «not sure» (unresolved). **Before Phase N** questions are added to the page before that phase. The rest of this register stays with the team. Workbook changes are listed in [CORRECTIONS.md](CORRECTIONS.md). Recorded answers live in [decisions/abdo-decisions.json](decisions/abdo-decisions.json); see [decisions/DECISIONS_SUMMARY.md](decisions/DECISIONS_SUMMARY.md).`);
lines.push("");
const count = (key) => Object.entries(data.findings.reduce((a, f) => ((a[f[key]] = (a[f[key]] || 0) + 1), a), {}));
const order = Object.keys(data.statuses);
const sc = Object.fromEntries(count("status"));
lines.push(`**${data.findings.length} findings.** Status: ${order.map((k) => `${data.statuses[k].en} ${sc[k] || 0}`).join(", ")}. Questions for Abdo: ${data.findings.filter((f) => f.abdo === "required").length} required to close Phase 1, ${data.findings.filter((f) => f.abdo === "later").length} before later phases. ${data.status_note || ""}`);
lines.push("");
lines.push(`By kind: ${count("kind").map(([k, n]) => `${data.kinds[k].en} ${n}`).join(", ")}. By severity: ${count("severity").map(([k, n]) => `${data.severities[k].en} ${n}`).join(", ")}.`);
lines.push("");
lines.push("| ID | Status | Needs Abdo | Area | Kind | Severity | Finding | Sources | Phases |");
lines.push("|---|---|---|---|---|---|---|---|---|");
for (const f of data.findings) {
  const src = [...new Set(f.locations.map((l) => l.source))].join(", ");
  const need = f.abdo === "required" ? "**Required**" : f.abdo === "later" ? `Before ${f.abdo_by}` : "";
  lines.push(`| [${f.id}](#${f.id.toLowerCase()}) | ${data.statuses[f.status].en} | ${need} | ${data.areas[f.area].en} | ${data.kinds[f.kind].en} | ${data.severities[f.severity].en} | ${f.title_en} | ${src} | ${(f.phases || []).join(", ")} |`);
}
lines.push("");
for (const f of data.findings) {
  lines.push(`## ${f.id}`);
  lines.push("");
  lines.push(`**${f.title_en}** — ${f.title_ar}`);
  lines.push("");
  lines.push(`- Status: **${data.statuses[f.status].en}**${f.abdo ? ` — needs Abdo (${f.abdo === "required" ? "required for Phase 1" : "before " + f.abdo_by})` : ""}`);
  lines.push(`- Done: ${f.resolution_en || ""}`);
  lines.push(`- Remaining: ${f.remaining_en || "None."}`);
  lines.push(`- Kind / severity: ${data.kinds[f.kind].en} / ${data.severities[f.severity].en}`);
  lines.push(`- Locations: ${f.locations.map((l) => `${l.source} \`${l.file}\` — ${l.where}`).join("; ")}`);
  lines.push(`- Verification: ${f.verification_en}`);
  lines.push(`- Affects phases: ${(f.phases || []).join(", ")}; reports: ${(f.reports || []).join("، ")}`);
  lines.push("");
  lines.push(`<div dir="rtl">`);
  lines.push("");
  lines.push(`**الموجود حاليًا:** ${f.now_ar}`);
  lines.push("");
  lines.push(`**المشكلة:** ${f.problem_ar}`);
  lines.push("");
  lines.push(`**الدليل:** ${f.evidence_ar}`);
  lines.push("");
  lines.push(`**التأثير:** ${f.impact_ar}`);
  lines.push("");
  lines.push(`**المقترح:** ${f.proposal_ar}`);
  lines.push("");
  lines.push(`**السبب:** ${f.why_ar}`);
  lines.push("");
  if (f.example_ar) lines.push(`**مثال:** قبل: ${f.example_ar.before} — بعد: ${f.example_ar.after}`), lines.push("");
  lines.push(`**التحقق:** ${f.verify_ar}`);
  lines.push("");
  if (f.related_ar?.length) lines.push(`**مرتبط:** ${f.related_ar.join(" · ")}`), lines.push("");
  lines.push(`**لو اختار «نُبقي الوضع الحالي»:** ${f.keep_means_ar}`);
  lines.push("");
  if (f.question_ar) lines.push(`**سؤال لعبدو:** ${f.question_ar}`), lines.push("");
  lines.push(`</div>`);
  lines.push("");
}
writeFileSync(join(repo, "docs", "phase1", "FINDINGS.md"), lines.join("\n"), "utf8");
console.log(`built ${qfile.questions.length} questions (of ${data.findings.length} findings) -> docs/phase1/review/abdo-review.html, abdo-review-trial.html; register -> docs/phase1/FINDINGS.md`);
