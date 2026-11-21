// Optional local server for the Phase 1 review page. No dependencies.
// Serves docs/phase1/review/abdo-review.html on this computer only and saves
// every answer Abdo makes straight into docs/phase1/decisions/abdo-decisions.json.
//
//   node scripts/phase1/review/review-server.mjs            # http://127.0.0.1:4173/
//   PORT=5000 DECISIONS_FILE=/tmp/test.json node ...         # tests / another file
//
// It listens on 127.0.0.1 only, so nothing is exposed to the network.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules, validateDecision, merge } from "./decision-rules.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const page = join(repo, "docs", "phase1", "review", "abdo-review.html");
const decisionsFile = resolve(process.env.DECISIONS_FILE || join(repo, "docs", "phase1", "decisions", "abdo-decisions.json"));
const port = Number(process.env.PORT || 4173);
const rules = loadRules(repo);
const findings = rules.findings;
function load() {
  if (!existsSync(decisionsFile)) return { schema: "blabn-phase1-decisions/1", reviewer: "Abdo", findings_version: findings.version, questions_version: rules.qfile.questions_version, decisions: {} };
  return JSON.parse(readFileSync(decisionsFile, "utf8"));
}

function validate(body) {
  if (!body || typeof body.decisions !== "object") throw new Error("missing decisions");
  const clean = {};
  for (const [id, d] of Object.entries(body.decisions)) clean[id] = validateDecision(id, d, rules);
  return clean;
}

function save(state) {
  mkdirSync(dirname(decisionsFile), { recursive: true });
  if (existsSync(decisionsFile)) copyFileSync(decisionsFile, decisionsFile + ".bak");
  const tmp = decisionsFile + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 1) + "\n", "utf8");
  renameSync(tmp, decisionsFile);
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (code, type, body) => { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }); res.end(body); };
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/abdo-review.html")) return send(200, "text/html; charset=utf-8", readFileSync(page));
  if (url.pathname === "/api/decisions" && req.method === "GET") return send(200, "application/json; charset=utf-8", JSON.stringify(load()));
  if (url.pathname === "/api/decisions" && req.method === "PUT") {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 5e6) req.destroy(); });
    req.on("end", () => {
      try {
        const incoming = validate(JSON.parse(raw));
        const current = load();
        const state = { schema: "blabn-phase1-decisions/1", reviewer: "Abdo", findings_version: findings.version, questions_version: rules.qfile.questions_version,
          updated_at: new Date().toISOString(), decisions: merge(current.decisions, incoming) };
        save(state);
        send(200, "application/json; charset=utf-8", JSON.stringify(state));
      } catch (e) { send(400, "application/json; charset=utf-8", JSON.stringify({ error: e.message })); }
    });
    return;
  }
  send(404, "text/plain; charset=utf-8", "not found");
}).listen(port, "127.0.0.1", () => {
  console.log(`Phase 1 review: http://127.0.0.1:${port}/`);
  console.log(`Saving answers to: ${decisionsFile}`);
});
