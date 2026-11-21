-- Phase 3 (3 of 4): the commands that manage accounts, and the checks the application asks.
--
-- Every `admin_*` command
--   * runs as the signed-in caller (auth.uid()) and refuses unless that caller is an ACTIVE staff
--     member who holds `admin.users.manage` right now,
--   * changes the access tables and writes its audit row in the same transaction,
--   * never sees or stores a password: Supabase Auth keeps credentials; the server sets them
--     through the Auth admin API and these commands only record that it happened.
-- Errors use fixed messages the application translates: permission_denied (42501), last_admin,
-- self_disable, not_found, invalid_input.

create function app_private.require_admin()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app_private.has_permission('admin.users.manage') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  return app_private.current_org();
end;
$$;

-- An organization must always keep one active System Admin.
create function app_private.assert_admin_remains(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.staff_accounts s
    join public.employees e on e.id = s.employee_id and e.is_active
    join public.staff_group_assignments a on a.staff_id = s.user_id and a.group_key = 'system_admin'
    where s.organization_id = p_org and s.is_active
  ) then
    raise exception 'last_admin' using errcode = 'P0001';
  end if;
end;
$$;

-- The access a caller asked for, as rows. Shape:
--   {"organization_groups": ["system_admin"],
--    "branches": [{"branch_id": "<uuid>", "groups": ["cashier", "manager"]}, ...]}
-- A branch listed with no groups is a membership that grants nothing yet.
create function app_private.desired_access(p_access jsonb)
returns table (kind text, group_key text, branch_id uuid)
language sql
immutable
set search_path = ''
as $$
  select 'member'::text, null::text, (x ->> 'branch_id')::uuid
  from jsonb_array_elements(coalesce(p_access -> 'branches', '[]'::jsonb)) x
  union
  select 'group', g.value, null::uuid
  from jsonb_array_elements_text(coalesce(p_access -> 'organization_groups', '[]'::jsonb)) g (value)
  union
  select 'group', g.value, (x ->> 'branch_id')::uuid
  from jsonb_array_elements(coalesce(p_access -> 'branches', '[]'::jsonb)) x,
       jsonb_array_elements_text(coalesce(x -> 'groups', '[]'::jsonb)) g (value);
$$;

-- Makes the stored access of one account equal the requested access and returns what changed.
create function app_private.apply_access(p_staff uuid, p_access jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed_groups jsonb;
  v_removed_members jsonb;
  v_added_members jsonb;
  v_added_groups jsonb;
begin
  if p_access is null or jsonb_typeof(p_access) <> 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  with gone as (
    delete from public.staff_group_assignments a
    where a.staff_id = p_staff
      and not exists (
        select 1 from app_private.desired_access(p_access) d
        where d.kind = 'group' and d.group_key = a.group_key and d.branch_id is not distinct from a.branch_id)
    returning a.group_key, a.branch_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('group', gone.group_key, 'branch', b.code) order by gone.group_key, b.code), '[]'::jsonb)
  into v_removed_groups
  from gone left join public.branches b on b.id = gone.branch_id;

  with gone as (
    delete from public.branch_memberships m
    where m.staff_id = p_staff
      and not exists (select 1 from app_private.desired_access(p_access) d where d.kind = 'member' and d.branch_id = m.branch_id)
    returning m.branch_id
  )
  select coalesce(jsonb_agg(b.code order by b.code), '[]'::jsonb)
  into v_removed_members
  from gone join public.branches b on b.id = gone.branch_id;

  with added as (
    insert into public.branch_memberships (staff_id, branch_id)
    select p_staff, d.branch_id
    from app_private.desired_access(p_access) d
    where d.kind = 'member'
    on conflict do nothing
    returning branch_id
  )
  select coalesce(jsonb_agg(b.code order by b.code), '[]'::jsonb)
  into v_added_members
  from added join public.branches b on b.id = added.branch_id;

  with added as (
    insert into public.staff_group_assignments (staff_id, group_key, branch_id)
    select p_staff, d.group_key, d.branch_id
    from app_private.desired_access(p_access) d
    where d.kind = 'group'
    on conflict do nothing
    returning group_key, branch_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('group', added.group_key, 'branch', b.code) order by added.group_key, b.code), '[]'::jsonb)
  into v_added_groups
  from added left join public.branches b on b.id = added.branch_id;

  return jsonb_build_object(
    'branches_added', v_added_members,
    'branches_removed', v_removed_members,
    'groups_added', v_added_groups,
    'groups_removed', v_removed_groups
  );
end;
$$;

create function app_private.access_changed(p_diff jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_diff <> jsonb_build_object(
    'branches_added', '[]'::jsonb, 'branches_removed', '[]'::jsonb,
    'groups_added', '[]'::jsonb, 'groups_removed', '[]'::jsonb);
$$;

-- ------------------------------------------------------------------ administrator commands

-- The sign-in account (p_user_id) is created first by the server through the Auth admin API.
create function public.admin_create_staff(
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

  insert into public.staff_accounts (user_id, employee_id, organization_id, email, must_change_password)
  values (p_user_id, v_employee, v_org, v_email, true);

  v_diff := app_private.apply_access(p_user_id, p_access);
  perform app_private.assert_admin_remains(v_org);

  perform app_private.write_audit(v_org, 'administration', 'staff.created', 'staff_account', p_user_id::text, v_name, null,
    jsonb_build_object('full_name', v_name, 'email', v_email, 'employee_number', v_number, 'credential_change_required', true, 'access', v_diff));
  return p_user_id;
end;
$$;

create function public.admin_update_staff(
  p_staff_id uuid,
  p_full_name text,
  p_email text,
  p_employee_number text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.require_admin();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_number text := nullif(btrim(coalesce(p_employee_number, '')), '');
  v_old record;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  if v_name = '' or position('@' in v_email) < 2 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select s.user_id, s.employee_id, s.email, e.full_name, e.employee_number
  into v_old
  from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = p_staff_id and s.organization_id = v_org
  for update of s, e;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_old.full_name is distinct from v_name then
    v_before := v_before || jsonb_build_object('full_name', v_old.full_name);
    v_after := v_after || jsonb_build_object('full_name', v_name);
  end if;
  if v_old.email is distinct from v_email then
    v_before := v_before || jsonb_build_object('email', v_old.email);
    v_after := v_after || jsonb_build_object('email', v_email);
  end if;
  if v_old.employee_number is distinct from v_number then
    v_before := v_before || jsonb_build_object('employee_number', v_old.employee_number);
    v_after := v_after || jsonb_build_object('employee_number', v_number);
  end if;
  if v_after = '{}'::jsonb then
    return false;
  end if;

  update public.employees set full_name = v_name, employee_number = v_number where id = v_old.employee_id;
  update public.staff_accounts set email = v_email where user_id = p_staff_id;

  perform app_private.write_audit(v_org, 'administration', 'staff.updated', 'staff_account', p_staff_id::text, v_name, null,
    jsonb_build_object('before', v_before, 'after', v_after));
  return true;
end;
$$;

create function public.admin_set_staff_access(p_staff_id uuid, p_access jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.require_admin();
  v_name text;
  v_diff jsonb;
begin
  select e.full_name into v_name
  from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = p_staff_id and s.organization_id = v_org
  for update of s;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  v_diff := app_private.apply_access(p_staff_id, p_access);
  if not app_private.access_changed(v_diff) then
    return false;
  end if;
  perform app_private.assert_admin_remains(v_org);

  perform app_private.write_audit(v_org, 'administration', 'staff.access_changed', 'staff_account', p_staff_id::text, v_name, null, v_diff);
  return true;
end;
$$;

create function public.admin_set_staff_active(p_staff_id uuid, p_active boolean, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.require_admin();
  v_old record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_active is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select s.user_id, s.employee_id, s.is_active, e.full_name
  into v_old
  from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = p_staff_id and s.organization_id = v_org
  for update of s, e;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not p_active and p_staff_id = auth.uid() then
    raise exception 'self_disable' using errcode = 'P0001';
  end if;
  if v_old.is_active = p_active then
    return false;
  end if;

  update public.staff_accounts
  set is_active = p_active,
      disabled_at = case when p_active then null else now() end,
      disabled_reason = case when p_active then null else v_reason end
  where user_id = p_staff_id;
  update public.employees set is_active = p_active where id = v_old.employee_id;

  if not p_active then
    perform app_private.assert_admin_remains(v_org);
    -- End the person's open sessions now. The live checks above already refuse every request;
    -- removing the sessions also stops token refresh. Skipped quietly where the database owner
    -- may not touch the auth schema (the checks do not depend on it).
    begin
      delete from auth.sessions where user_id = p_staff_id;
    exception when insufficient_privilege or undefined_table then
      null;
    end;
  end if;

  perform app_private.write_audit(v_org, 'administration',
    case when p_active then 'staff.reactivated' else 'staff.disabled' end,
    'staff_account', p_staff_id::text, v_old.full_name, null,
    jsonb_build_object('is_active', p_active, 'reason', v_reason));
  return true;
end;
$$;

-- Called after the server set a temporary password through the Auth admin API.
create function public.admin_record_password_reset(p_staff_id uuid)
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

  update public.staff_accounts set must_change_password = true where user_id = p_staff_id;
  perform app_private.write_audit(v_org, 'administration', 'staff.password_reset_issued', 'staff_account', p_staff_id::text, v_name, null,
    jsonb_build_object('credential_change_required', true));
end;
$$;

-- ------------------------------------------------------------------ questions the application asks

-- What the signed-in person may do right now. For menus and display; decisions use app_authorize.
create function public.app_access_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  r record;
begin
  if v_uid is null then
    return jsonb_build_object('state', 'anonymous');
  end if;
  select s.user_id, s.email, s.is_active, s.must_change_password, e.full_name, e.is_active as employee_active
  into r
  from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = v_uid;
  if not found then
    return jsonb_build_object('state', 'unregistered');
  end if;
  if not r.is_active or not r.employee_active then
    return jsonb_build_object('state', 'disabled');
  end if;
  return jsonb_build_object(
    'state', 'active',
    'user_id', r.user_id,
    'full_name', r.full_name,
    'email', r.email,
    'must_change_password', r.must_change_password,
    'permissions', (
      select coalesce(jsonb_agg(jsonb_build_object('permission', p.permission_key, 'branch', b.code)
                                order by p.permission_key, b.code), '[]'::jsonb)
      from app_private.effective_permissions() p
      left join public.branches b on b.id = p.branch_id
    )
  );
end;
$$;

-- The single yes/no every page, action, download and command asks. p_branch_code is NULL for
-- organization permissions.
create function public.app_authorize(p_permission text, p_branch_code text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.has_permission(
    p_permission,
    case when p_branch_code is null then null
         else (select b.id from public.branches b
               where b.code = p_branch_code and b.organization_id = app_private.current_org())
    end
  )
  and (p_branch_code is null or exists (
    select 1 from public.branches b
    where b.code = p_branch_code and b.organization_id = app_private.current_org()));
$$;

-- The signed-in person has set their own password.
create function public.app_complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := app_private.current_org();
  v_name text;
begin
  if v_org is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select e.full_name into v_name
  from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = auth.uid();

  update public.staff_accounts set must_change_password = false
  where user_id = auth.uid() and must_change_password;
  if found then
    perform app_private.write_audit(v_org, 'security', 'account.password_changed', 'staff_account', auth.uid()::text, v_name, null,
      jsonb_build_object('credential_change_required', false));
  end if;
end;
$$;

-- ------------------------------------------------------------------ first administrator

-- Makes an existing Auth user the first System Admin of an organization. Only the service role
-- may call it (see the grants in migration 8): the bootstrap script runs it once per
-- environment. It refuses when the organization already has an active System Admin.
create function public.app_bootstrap_system_admin(
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
  insert into public.staff_accounts (user_id, employee_id, organization_id, email, must_change_password)
  values (p_user_id, v_employee, p_organization_id, v_email, true);
  insert into public.staff_group_assignments (staff_id, group_key, branch_id) values (p_user_id, 'system_admin', null);

  perform app_private.write_audit(p_organization_id, 'administration', 'bootstrap.system_admin', 'staff_account', p_user_id::text, v_name, null,
    jsonb_build_object('full_name', v_name, 'email', v_email, 'groups', jsonb_build_array('system_admin'), 'credential_change_required', true));
  return p_user_id;
end;
$$;
