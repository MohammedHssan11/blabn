// Prints the aggregate metrics of the trial's attempts and enrollments (no image, no embedding exists):
//   node scripts/attendance/trial-report.mjs [--since <ISO time>]
import { container } from "../phase3/db-check.mjs";
import { run } from "../phase3/lib.mjs";

const since = process.argv.includes("--since") ? process.argv[process.argv.indexOf("--since") + 1] : "1970-01-01";
const sql = `select json_agg(row_to_json(t) order by t.created_at) from (
  select to_char(created_at at time zone 'Africa/Casablanca', 'HH24:MI:SS') as at, created_at, action, status, reason,
    verification->>'match_score' as match, verification->>'min_frame_score' as min_frame, verification->>'parallax' as parallax,
    verification->>'observed' as observed, verification->>'challenge' as challenge, verification->>'frames' as frames,
    verification->>'faces_found' as faces, verification->>'processing_ms' as ms,
    extract(epoch from (completed_at - created_at))::numeric(6,1) as seconds
  from public.attendance_attempts where created_at >= '${since}'::timestamptz) t;`;
const result = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX"], { input: sql });
const rows = JSON.parse(result.stdout.trim() || "null") ?? [];
for (const r of rows) {
  console.log([r.at, r.action, r.status, r.reason ?? "", `match=${r.match ?? "-"}`, `min=${r.min_frame ?? "-"}`, `parallax=${r.parallax ?? "-"}`,
    `challenge=${r.challenge ?? "-"}`, `observed=${r.observed ?? "-"}`, `frames=${r.frames ?? "-"}/${r.faces ?? "-"}`, `verifier=${r.ms ?? "-"}ms`,
    `total=${r.seconds ?? "-"}s`].join("  "));
}
const enroll = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX"], {
  input: "select status, coalesce(reason, ''), to_char(created_at at time zone 'Africa/Casablanca', 'HH24:MI:SS') from app_private.attendance_enrollments order by created_at;",
});
console.log(`\nenrollments:\n${enroll.stdout.trim()}`);
const quality = run("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-AtX"], {
  input: "select status, quality::text from app_private.attendance_face_references order by enrolled_at;",
});
console.log(`references (aggregate quality only):\n${quality.stdout.trim()}`);
