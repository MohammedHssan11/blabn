-- Phase 3 (4 of 4): row-level security policies, explicit grants and operating-action auditing.
--
-- Phase 2 left every table closed to the API roles. This migration opens exactly what each
-- permission needs and nothing else:
--   * every table has RLS on; `anon` has no access to anything;
--   * `authenticated` gets the privileges listed below, and every row it can read or write must
--     also pass a policy that asks app_private.has_permission() (live, per request);
--   * identity, permission and audit tables are read-only to the API roles: changes come only
--     from the administrator commands of migration 7;
--   * the audit history cannot be changed by any API role;
--   * tables, functions and sequences created later start with NO API access.

-- ------------------------------------------------------------------ inventory adjustments (skeleton)
-- Phase 6 builds stock movements. The permission-checked skeleton exists now so the rule
-- "a cashier cannot adjust inventory" is enforced by the database before any stock data exists.
-- Phase 6 adds products, units and quantities with forward migrations.

create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches (id),
  business_date date not null,
  reason text not null check (length(btrim(reason)) > 0),
  note text not null default '',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create index inventory_adjustments_branch_date_idx on public.inventory_adjustments (branch_id, business_date);

-- ------------------------------------------------------------------ helpers for policies

create function app_private.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.employee_id
  from public.staff_accounts s
  join public.employees e on e.id = s.employee_id
  where s.user_id = auth.uid() and s.is_active and e.is_active;
$$;

create function app_private.staff_in_my_organization(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_accounts s
    where s.user_id = p_staff and s.organization_id = app_private.current_org());
$$;

-- ------------------------------------------------------------------ row-level security

alter table public.employees enable row level security;
alter table public.staff_accounts enable row level security;
alter table public.permissions enable row level security;
alter table public.permission_groups enable row level security;
alter table public.group_permissions enable row level security;
alter table public.branch_memberships enable row level security;
alter table public.staff_group_assignments enable row level security;
alter table public.audit_log enable row level security;
alter table public.inventory_adjustments enable row level security;

-- Organization and branches: a person sees their own organization and the branches they belong to.
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = app_private.current_org());

create policy branches_select on public.branches
  for select to authenticated
  using (app_private.can_see_branch(id));

-- Identities and access: an administrator reads the whole organization, everyone else only their own.
create policy employees_select on public.employees
  for select to authenticated
  using (
    (organization_id = app_private.current_org() and app_private.has_permission('admin.users.manage'))
    or id = app_private.current_employee_id()
  );

create policy staff_accounts_select on public.staff_accounts
  for select to authenticated
  using (
    (organization_id = app_private.current_org() and app_private.has_permission('admin.users.manage'))
    or user_id = app_private.current_staff_id()
  );

create policy branch_memberships_select on public.branch_memberships
  for select to authenticated
  using (
    staff_id = app_private.current_staff_id()
    or (app_private.has_permission('admin.users.manage') and app_private.staff_in_my_organization(staff_id))
  );

create policy staff_group_assignments_select on public.staff_group_assignments
  for select to authenticated
  using (
    staff_id = app_private.current_staff_id()
    or (app_private.has_permission('admin.users.manage') and app_private.staff_in_my_organization(staff_id))
  );

-- The catalog is readable by any active staff member.
create policy permissions_select on public.permissions
  for select to authenticated using (app_private.current_staff_id() is not null);
create policy permission_groups_select on public.permission_groups
  for select to authenticated using (app_private.current_staff_id() is not null);
create policy group_permissions_select on public.group_permissions
  for select to authenticated using (app_private.current_staff_id() is not null);

-- Audit history: read with the audit-review permission; nobody writes through the API.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (organization_id = app_private.current_org() and app_private.has_permission('admin.audit.view'));

-- Daily close (Phase 2 tables). Drafts need `daily_close.draft` while the day is open;
-- closing a day or changing a closed day needs `daily_close.close`.
create policy business_days_select on public.business_days
  for select to authenticated
  using (app_private.has_permission('daily_close.view', branch_id));

create policy business_days_insert on public.business_days
  for insert to authenticated
  with check (status = 'open' and app_private.has_permission('daily_close.draft', branch_id));

create policy business_days_update on public.business_days
  for update to authenticated
  using (
    (status = 'open' and app_private.has_permission('daily_close.draft', branch_id))
    or app_private.has_permission('daily_close.close', branch_id)
  )
  with check (
    (status = 'open' and app_private.has_permission('daily_close.draft', branch_id))
    or app_private.has_permission('daily_close.close', branch_id)
  );

create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using (app_private.has_permission('daily_close.view', app_private.branch_of_day(business_day_id)));

create policy cash_movements_insert on public.cash_movements
  for insert to authenticated
  with check (
    app_private.day_is_open(business_day_id)
    and app_private.has_permission('daily_close.draft', app_private.branch_of_day(business_day_id))
  );

create policy cash_counts_select on public.cash_counts
  for select to authenticated
  using (app_private.has_permission('daily_close.view', app_private.branch_of_day(business_day_id)));

create policy cash_counts_insert on public.cash_counts
  for insert to authenticated
  with check (app_private.has_permission('cash_count.enter', app_private.branch_of_day(business_day_id)));

-- Comparison figures: entering, viewing and exporting are three separate permissions.
-- Entering does not let the editor read what was entered (and an update would need to read the
-- row, so corrections arrive with the revision history in Phase 7).
create policy comparison_figures_select on public.comparison_figures
  for select to authenticated
  using (app_private.has_permission('comparison.view', branch_id));

create policy comparison_figures_insert on public.comparison_figures
  for insert to authenticated
  with check (app_private.has_permission('comparison.enter', branch_id));

create policy inventory_adjustments_select on public.inventory_adjustments
  for select to authenticated
  using (app_private.has_permission('inventory.view', branch_id));

create policy inventory_adjustments_insert on public.inventory_adjustments
  for insert to authenticated
  with check (created_by = auth.uid() and app_private.has_permission('inventory.adjust', branch_id));

-- ------------------------------------------------------------------ auditing of operating actions
-- Rows written by a signed-in person are recorded with that person as the actor. Statements with
-- no signed-in person (the seed, the service role) are not recorded here; commands that run as
-- the service role write their own audit rows.

create function app_private.audit_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_branch uuid;
  v_org uuid;
  v_changes jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_branch := coalesce((v_new ->> 'branch_id')::uuid, app_private.branch_of_day((v_new ->> 'business_day_id')::uuid));
  select b.organization_id into v_org from public.branches b where b.id = v_branch;

  if tg_op = 'INSERT' then
    v_changes := jsonb_build_object('new', v_new);
  else
    v_old := to_jsonb(old);
    v_changes := jsonb_build_object(
      'before', (select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb)
                 from jsonb_each(v_old) o where v_new -> o.key is distinct from o.value),
      'after', (select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb)
                from jsonb_each(v_new) n where v_old -> n.key is distinct from n.value));
  end if;

  perform app_private.write_audit(v_org, 'operation',
    tg_table_name || case when tg_op = 'INSERT' then '.created' else '.updated' end,
    tg_table_name, v_new ->> 'id', null, v_branch, v_changes);
  return null;
end;
$$;

create trigger business_days_audit after insert or update on public.business_days
  for each row execute function app_private.audit_operation();
create trigger cash_movements_audit after insert on public.cash_movements
  for each row execute function app_private.audit_operation();
create trigger cash_counts_audit after insert on public.cash_counts
  for each row execute function app_private.audit_operation();
create trigger comparison_figures_audit after insert on public.comparison_figures
  for each row execute function app_private.audit_operation();
create trigger inventory_adjustments_audit after insert on public.inventory_adjustments
  for each row execute function app_private.audit_operation();

-- ------------------------------------------------------------------ explicit grants

-- Start from nothing, then grant exactly what the policies above are written for.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema app_private from public, anon, authenticated;

-- Later objects start closed too (owner of the objects created by migrations).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

grant select on
  public.organizations, public.branches, public.employees, public.staff_accounts,
  public.permissions, public.permission_groups, public.group_permissions,
  public.branch_memberships, public.staff_group_assignments, public.audit_log,
  public.business_days, public.cash_movements, public.cash_counts, public.comparison_figures,
  public.branch_daily_figures, public.inventory_adjustments
to authenticated;

grant insert on
  public.business_days, public.cash_movements, public.cash_counts,
  public.comparison_figures, public.inventory_adjustments
to authenticated;

grant update on public.business_days to authenticated;

-- The audit history is append-only for everybody, including the service role.
revoke insert, update, delete, truncate on public.audit_log from service_role;

grant usage on schema app_private to authenticated, service_role;

grant execute on function
  app_private.has_permission(text, uuid),
  app_private.can_see_branch(uuid),
  app_private.current_staff_id(),
  app_private.current_org(),
  app_private.current_employee_id(),
  app_private.staff_in_my_organization(uuid),
  app_private.branch_of_day(uuid),
  app_private.day_is_open(uuid)
to authenticated;

grant execute on function public.business_date_of(timestamptz, text, time) to authenticated;

grant execute on function
  public.app_access_context(),
  public.app_authorize(text, text),
  public.app_complete_password_change(),
  public.admin_create_staff(uuid, text, text, text, jsonb),
  public.admin_update_staff(uuid, text, text, text),
  public.admin_set_staff_access(uuid, jsonb),
  public.admin_set_staff_active(uuid, boolean, text),
  public.admin_record_password_reset(uuid)
to authenticated;

grant execute on function public.app_bootstrap_system_admin(uuid, uuid, text, text) to service_role;
