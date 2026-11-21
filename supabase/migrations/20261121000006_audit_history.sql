-- Phase 3 (2 of 4): append-only audit history.
--
-- Rows are written only by the administrator commands (migration 7), the bootstrap command and
-- the row triggers of migration 8, all of which run with the owner's rights. No API role can
-- insert, update or delete: the grants are SELECT only (through a policy that needs the
-- audit-review permission), and a trigger refuses UPDATE, DELETE and TRUNCATE for every role.
-- The `changes` column holds field names and values of the change, never credentials.

create table public.audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  organization_id uuid references public.organizations (id),
  -- Auth user who acted. NULL for a system action such as the first-administrator bootstrap.
  -- Deliberately no foreign key: the history must outlive any account.
  actor_id uuid,
  -- Name of the actor when the action happened (a later rename does not rewrite history).
  actor_name text not null check (length(btrim(actor_name)) > 0),
  category text not null check (category in ('administration', 'operation', 'security')),
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  target_type text not null check (length(btrim(target_type)) > 0),
  target_id text,
  target_label text,
  branch_id uuid references public.branches (id),
  changes jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  -- Defence in depth: refuse a change record that has a credential-like field name anywhere.
  constraint audit_changes_hold_no_credentials
    check (changes::text !~* '"[a-z_ -]*(password|passwd|secret|token|api_?key|service_?role)[a-z_ -]*"\s*:')
);

create index audit_log_org_time_idx on public.audit_log (organization_id, occurred_at desc);
create index audit_log_target_idx on public.audit_log (target_type, target_id);

create function app_private.refuse_audit_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'the audit history is append-only (% on audit_log refused)', tg_op
    using errcode = '42501';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function app_private.refuse_audit_change();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function app_private.refuse_audit_change();

-- Appends one audit row. The actor is the signed-in user; with no signed-in user (the bootstrap
-- command, which runs as the service role) the actor is recorded as the system.
create function app_private.write_audit(
  p_organization uuid,
  p_category text,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_target_label text,
  p_branch uuid,
  p_changes jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select e.full_name into v_name
  from public.staff_accounts s
  join public.employees e on e.id = s.employee_id
  where s.user_id = auth.uid();

  insert into public.audit_log
    (organization_id, actor_id, actor_name, category, action, target_type, target_id, target_label, branch_id, changes)
  values
    (p_organization, auth.uid(), coalesce(v_name, 'system'), p_category, p_action, p_target_type,
     p_target_id, p_target_label, p_branch, coalesce(p_changes, '{}'::jsonb));
end;
$$;
