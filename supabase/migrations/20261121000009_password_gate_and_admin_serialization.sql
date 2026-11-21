-- Phase 3 audit fixes (forward migration over 20261121000005-08).
--
-- 1. TEMPORARY PASSWORD GATE IN THE DATABASE.
--    An account flagged `must_change_password` (new account, administrator reset, bootstrap) used
--    to be refused only by the Next.js guard; a valid JWT used directly against the Data API still
--    passed every policy. Now the permission functions themselves return nothing for a flagged
--    account, so every policy, command and `app_authorize` refuses it. What a flagged person keeps:
--    `app_access_context` (to learn the state), `app_complete_password_change`, and reading their
--    own staff, employee and assignment rows.
--
--    The flag used to be cleared by `app_complete_password_change()` on request, so a flagged
--    person could clear it without ever changing the password. Now the flag carries a fingerprint
--    (SHA-256, never the hash itself) of the account's Auth password hash taken when it was set,
--    and the command clears the flag only when Supabase Auth has stored a DIFFERENT hash: the
--    password really was changed by the trusted authentication flow (sign-in session update or
--    recovery link). Only then is the completion audit record written.
--
-- 2. ADMINISTRATOR CHANGES ARE SERIALIZED PER ORGANIZATION.
--    "At least one active System Admin" was checked inside each command, but two transactions
--    could each see the other's admin still active and both commit (two administrators disabling
--    each other left none). Every administrator command now takes a transaction-scoped advisory
--    lock for the organization, and re-checks the CALLER's permission after the lock is held (the
--    caller may have been demoted or disabled while waiting) before the last-admin rule is
--    evaluated. The bootstrap takes the same lock.

-- ------------------------------------------------------------------ fingerprint column

alter table public.staff_accounts add column password_fingerprint text;

create function app_private.password_fingerprint(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(u.encrypted_password, ''), 'UTF8')), 'hex')
  from auth.users u
  where u.id = p_user;
$$;

-- Accounts already flagged when this migration runs: fingerprint the current (temporary) password.
update public.staff_accounts s
set password_fingerprint = app_private.password_fingerprint(s.user_id)
where s.must_change_password;

alter table public.staff_accounts
  add constraint flagged_account_has_fingerprint
  check (not must_change_password or password_fingerprint is not null);

-- ------------------------------------------------------------------ the gate in the permission functions

-- Active staff member who is NOT waiting to choose a new password.
create function app_private.access_cleared()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_accounts s
    join public.employees e on e.id = s.employee_id
    where s.user_id = auth.uid() and s.is_active and e.is_active and not s.must_change_password);
$$;

create or replace function app_private.effective_permissions()
returns table (permission_key text, branch_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.key,
         case when p.scope = 'organization' then null else b.id end
  from public.staff_accounts s
  join public.employees e on e.id = s.employee_id and e.is_active
  join public.staff_group_assignments a on a.staff_id = s.user_id
  join public.group_permissions gp on gp.group_key = a.group_key
  join public.permissions p on p.key = gp.permission_key
  left join public.branches b
    on p.scope = 'branch'
   and b.organization_id = s.organization_id
   and (a.branch_id = b.id or a.branch_id is null)
   and (
        p.branch_kind = 'any'
     or (p.branch_kind = 'operational' and b.operates_in_app)
     or (p.branch_kind = 'comparison' and not b.operates_in_app)
   )
  where s.user_id = auth.uid()
    and s.is_active
    and not s.must_change_password
    and (
         (p.scope = 'organization' and a.branch_id is null)
      or (p.scope = 'branch' and b.id is not null)
    );
$$;

create or replace function app_private.can_see_branch(p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_accounts s
    join public.employees e on e.id = s.employee_id and e.is_active
    join public.branches b on b.id = p_branch and b.organization_id = s.organization_id
    where s.user_id = auth.uid() and s.is_active and not s.must_change_password
      and (
        exists (select 1 from public.branch_memberships m where m.staff_id = s.user_id and m.branch_id = b.id)
        or exists (select 1 from public.staff_group_assignments a where a.staff_id = s.user_id and a.branch_id is null)
      )
  );
$$;

-- The catalog is for people who may use the application.
drop policy permissions_select on public.permissions;
drop policy permission_groups_select on public.permission_groups;
drop policy group_permissions_select on public.group_permissions;
create policy permissions_select on public.permissions
  for select to authenticated using (app_private.access_cleared());
create policy permission_groups_select on public.permission_groups
  for select to authenticated using (app_private.access_cleared());
create policy group_permissions_select on public.group_permissions
  for select to authenticated using (app_private.access_cleared());

-- ------------------------------------------------------------------ serialized administrator commands

create or replace function app_private.require_admin()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null or not app_private.has_permission('admin.users.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_org := app_private.current_org();

  -- One administrator change per organization at a time. Held until this transaction ends.
  perform pg_advisory_xact_lock(hashtextextended('balaban.system_admin.' || v_org::text, 0));

  -- The caller may have been demoted or disabled while this transaction waited for the lock.
  -- Each statement of this function sees what other transactions have committed since.
  if not app_private.has_permission('admin.users.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  return v_org;
end;
$$;

create or replace function public.admin_create_staff(
  p_user_id uuid,
  p_full_name text,
  p_email text,
  p_employee_number text default null,
  p_access jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.require_admin();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_number text := nullif(btrim(coalesce(p_employee_number, '')), '');
  v_employee uuid;
  v_diff jsonb;
begin
  if v_name = '' or position('@' in v_email) < 2 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = v_email) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  insert into public.employees (organization_id, full_name, employee_number)
  values (v_org, v_name, v_number)
  returning id into v_employee;

  insert into public.staff_accounts (user_id, employee_id, organization_id, email, must_change_password, password_fingerprint)
  values (p_user_id, v_employee, v_org, v_email, true, app_private.password_fingerprint(p_user_id));

  v_diff := app_private.apply_access(p_user_id, p_access);
  perform app_private.assert_admin_remains(v_org);

  perform app_private.write_audit(v_org, 'administration', 'staff.created', 'staff_account', p_user_id::text, v_name, null,
    jsonb_build_object('full_name', v_name, 'email', v_email, 'employee_number', v_number, 'credential_change_required', true, 'access', v_diff));
  return p_user_id;
end;
$$;

create or replace function public.admin_record_password_reset(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.require_admin();
  v_name text;
begin
  select e.full_name into v_name
  from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = p_staff_id and s.organization_id = v_org
  for update of s;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Called after the server set the temporary password: fingerprint that password, so only a LATER
  -- change by the person ends the requirement.
  update public.staff_accounts
  set must_change_password = true,
      password_fingerprint = app_private.password_fingerprint(p_staff_id)
  where user_id = p_staff_id;
  perform app_private.write_audit(v_org, 'administration', 'staff.password_reset_issued', 'staff_account', p_staff_id::text, v_name, null,
    jsonb_build_object('credential_change_required', true));
end;
$$;

-- The signed-in person asks to be released from the temporary-password requirement. Released only
-- when Supabase Auth now holds a different password hash than the temporary one.
create or replace function public.app_complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.current_org();
  v_name text;
  v_flagged boolean;
  v_snapshot text;
begin
  if v_org is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select s.must_change_password, s.password_fingerprint, e.full_name
  into v_flagged, v_snapshot, v_name
  from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = auth.uid()
  for update of s;

  if not v_flagged then
    return;
  end if;
  if app_private.password_fingerprint(auth.uid()) is not distinct from v_snapshot then
    raise exception 'password_not_changed' using errcode = 'P0001';
  end if;

  update public.staff_accounts
  set must_change_password = false, password_fingerprint = null
  where user_id = auth.uid();
  perform app_private.write_audit(v_org, 'security', 'account.password_changed', 'staff_account', auth.uid()::text, v_name, null,
    jsonb_build_object('credential_change_required', false));
end;
$$;

create or replace function public.app_bootstrap_system_admin(
  p_user_id uuid,
  p_organization_id uuid,
  p_full_name text,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_employee uuid;
begin
  if v_name = '' or position('@' in v_email) < 2 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = v_email) then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Same lock as the administrator commands.
  perform pg_advisory_xact_lock(hashtextextended('balaban.system_admin.' || p_organization_id::text, 0));

  if exists (
    select 1
    from public.staff_accounts s
    join public.staff_group_assignments a on a.staff_id = s.user_id and a.group_key = 'system_admin'
    where s.organization_id = p_organization_id and s.is_active
  ) then
    raise exception 'admin_exists' using errcode = 'P0001';
  end if;

  insert into public.employees (organization_id, full_name) values (p_organization_id, v_name)
  returning id into v_employee;
  insert into public.staff_accounts (user_id, employee_id, organization_id, email, must_change_password, password_fingerprint)
  values (p_user_id, v_employee, p_organization_id, v_email, true, app_private.password_fingerprint(p_user_id));
  insert into public.staff_group_assignments (staff_id, group_key, branch_id) values (p_user_id, 'system_admin', null);

  perform app_private.write_audit(p_organization_id, 'administration', 'bootstrap.system_admin', 'staff_account', p_user_id::text, v_name, null,
    jsonb_build_object('full_name', v_name, 'email', v_email, 'groups', jsonb_build_array('system_admin'), 'credential_change_required', true));
  return p_user_id;
end;
$$;

-- ------------------------------------------------------------------ grants for the new objects

revoke all on function app_private.password_fingerprint(uuid) from public, anon, authenticated;
revoke all on function app_private.access_cleared() from public, anon, authenticated;
grant execute on function app_private.access_cleared() to authenticated;

-- ------------------------------------------------------------------ the fingerprint is not readable through the API
-- Only the database functions read password_fingerprint. The API roles get SELECT on every other
-- column of staff_accounts (and still only through the row policies).
revoke select on public.staff_accounts from authenticated;
grant select (user_id, employee_id, organization_id, email, is_active, must_change_password, disabled_at, disabled_reason, created_at, updated_at)
  on public.staff_accounts to authenticated;
