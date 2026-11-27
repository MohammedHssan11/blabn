"""Generate the forward migration by changing only capture-replay lines in the prior functions."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
source = (root / "supabase/migrations/20261129090000_attendance.sql").read_text(encoding="utf-8").replace("\r\n", "\n")
target = root / "supabase/migrations/20261201090000_attendance_capture_replay.sql"


def function(name):
    start = source.index(f"create function {name}(")
    end = source.index("\n$$;\n", start) + len("\n$$;\n")
    return source[start:end].replace("create function", "create or replace function", 1)


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise ValueError(f"Expected one occurrence: {before[:80]}")
    return text.replace(before, after)


start = function("public.app_attendance_attempt_start")
start = replace_once(start, "'face_inconsistent', 'invalid_verifier_signature', 'poor_quality')) >= 5 then",
                     "'face_inconsistent', 'invalid_verifier_signature', 'capture_replayed', 'poor_quality')) >= 5 then")

complete = function("public.app_attendance_attempt_complete")
complete = replace_once(complete, "  v_employee uuid;\n", "  v_employee uuid;\n  v_capture text := p_result->>'capture_hash';\n  v_inserted uuid;\n")
complete = replace_once(complete, "'balaban-attendance', 'attempt', 'v1',", "'balaban-attendance', 'attempt', 'v2',")
complete = replace_once(complete, "    array_to_string(a.challenge, ','), v_outcome, coalesce(v_reason, ''), v_engine, p_result->>'issued_at_ms', v_key));",
                        "    array_to_string(a.challenge, ','), v_capture, v_outcome, coalesce(v_reason, ''), v_engine, p_result->>'issued_at_ms', v_key));")
complete = replace_once(complete, "  v_ok := v_expected is not null and v_expected = lower(coalesce(p_signature, ''))",
                        "  v_ok := coalesce(v_capture, '') ~ '^[0-9a-f]{64}$'\n          and v_expected is not null and v_expected = lower(coalesce(p_signature, ''))")
anchor = "  insert into public.attendance_events (organization_id, branch_id, employee_id, kind, occurred_at, source, device_id, attempt_id)\n"
guard = """  -- Exact-byte replay defense only. The private HMAC is stable across verifier signing-key rotation.
  -- The unique index serializes concurrent completions, including attempts for different employees.
  insert into app_private.attendance_used_captures (organization_id, attempt_id, fingerprint)
  select a.organization_id, a.id, extensions.hmac(decode(v_capture, 'hex'), s.secret, 'sha256')
  from app_private.attendance_capture_secret s where s.singleton
  on conflict (organization_id, fingerprint) do nothing
  returning attempt_id into v_inserted;
  if v_inserted is null then
    update public.attendance_attempts
    set status = 'failed', reason = 'capture_replayed', completed_at = now(), verification = v_metrics
    where id = a.id returning * into a;
    return app_private.attendance_attempt_view(a);
  end if;

"""
complete = replace_once(complete, anchor, guard + anchor)

header = """-- Exact-capture replay defense; this does NOT establish trusted camera capture or prevent altered video.
-- Store only a database-keyed HMAC of a verifier-signed digest, never frames, images or face embeddings.
-- The key is generated locally on migration; neither the key nor capture fingerprints are exposed to API roles.
create table app_private.attendance_capture_secret (
  singleton boolean primary key default true check (singleton),
  secret bytea not null default extensions.gen_random_bytes(32) check (octet_length(secret) = 32)
);
insert into app_private.attendance_capture_secret (singleton) values (true);
alter table app_private.attendance_capture_secret enable row level security;
revoke all on app_private.attendance_capture_secret from public, anon, authenticated, service_role;

create table app_private.attendance_used_captures (
  organization_id uuid not null references public.organizations(id),
  attempt_id uuid not null unique references public.attendance_attempts(id),
  fingerprint bytea not null check (octet_length(fingerprint) = 32),
  created_at timestamptz not null default now(),
  primary key (organization_id, fingerprint)
);
alter table app_private.attendance_used_captures enable row level security;
revoke all on app_private.attendance_used_captures from public, anon, authenticated, service_role;

-- Attendance reports group by calendar date, not the branch's 02:00 business-day rollover.
create function public.app_attendance_today()
returns date language sql stable security definer set search_path = '' as $$
  select (now() at time zone b.timezone)::date
  from public.branches b
  where b.organization_id = app_private.current_org() and b.operates_in_app
  order by b.code limit 1;
$$;
revoke all on function public.app_attendance_today() from public, anon, authenticated, service_role;
grant execute on function public.app_attendance_today() to authenticated;

"""
result = header + start + "\n" + complete
if "--check" in sys.argv:
    if not target.exists() or target.read_text(encoding="utf-8") != result:
        sys.exit("attendance replay migration differs from generator")
else:
    target.write_text(result, encoding="utf-8", newline="\n")
    print(f"wrote {target}")
