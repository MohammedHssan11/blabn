-- Phase 3 database checks: accounts, permissions, row-level security and the audit history.
-- Run against a local database built from all migrations and seed.sql:
--   npm run db:check:phase3
-- Everything runs in one transaction that is rolled back. A failed check raises an exception.
--
-- People are simulated the way Supabase does it: the role `authenticated` plus the JWT claim
-- `sub` (auth.uid()). Only the signed-in user id is used, never a permission claim, so a check
-- proves that the database consults the live tables on every statement.

begin;

-- ===================================================================== 1. Structure and grants
do $$
declare
  t record;
  rel text;
begin
  -- RLS on every public table; the API roles hold no write grant on identity, catalog or audit tables.
  for t in select c.relname, c.relrowsecurity from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind = 'r' loop
    assert t.relrowsecurity, format('RLS is off for public.%s', t.relname);
  end loop;

  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r', 'v') loop
    assert not has_table_privilege('anon', 'public.' || t.relname, 'select,insert,update,delete,truncate,references,trigger'),
      format('anon has a privilege on public.%s', t.relname);
  end loop;

  assert has_any_column_privilege('authenticated', 'public.staff_accounts', 'select')
     and not has_column_privilege('authenticated', 'public.staff_accounts', 'password_fingerprint', 'select')
     and not has_table_privilege('authenticated', 'public.staff_accounts', 'insert,update,delete,truncate'),
    'the API reads staff accounts except the password fingerprint and cannot write them';
  foreach rel in array array['employees', 'permissions', 'permission_groups',
      'group_permissions', 'branch_memberships', 'staff_group_assignments', 'audit_log', 'organizations', 'branches'] loop
    assert has_table_privilege('authenticated', 'public.' || rel, 'select'), format('authenticated cannot select %s', rel);
    assert not has_table_privilege('authenticated', 'public.' || rel, 'insert,update,delete,truncate'),
      format('authenticated can write public.%s', rel);
  end loop;
  assert not has_table_privilege('authenticated', 'public.cash_counts', 'update,delete'), 'cash counts are append-only for the API';
  assert not has_table_privilege('authenticated', 'public.comparison_figures', 'update,delete'), 'comparison figures cannot be updated by the API';
  assert not has_table_privilege('service_role', 'public.audit_log', 'insert,update,delete,truncate'), 'service_role must not write the audit history';

  -- Functions: the bootstrap command is for the service role only; helpers are closed to anon.
  assert has_function_privilege('service_role', 'public.app_bootstrap_system_admin(uuid,uuid,text,text)', 'execute'), 'service role bootstraps';
  assert not has_function_privilege('authenticated', 'public.app_bootstrap_system_admin(uuid,uuid,text,text)', 'execute'), 'authenticated must not bootstrap';
  assert not has_function_privilege('anon', 'public.app_bootstrap_system_admin(uuid,uuid,text,text)', 'execute'), 'anon must not bootstrap';
  assert not has_function_privilege('anon', 'public.admin_create_staff(uuid,text,text,text,jsonb)', 'execute'), 'anon must not manage staff';
  assert not has_function_privilege('anon', 'public.app_authorize(text,text)', 'execute'), 'anon must not call app_authorize';
  assert not has_function_privilege('authenticated', 'app_private.write_audit(uuid,text,text,text,text,text,uuid,jsonb)', 'execute'), 'audit writer is private';
  assert not has_function_privilege('authenticated', 'app_private.apply_access(uuid,jsonb)', 'execute'), 'apply_access is private';

  -- Anything created later starts closed (default privileges).
  create table public.zz_future_table (id int);
  create function public.zz_future_fn() returns int language sql as 'select 1';
  assert not has_table_privilege('authenticated', 'public.zz_future_table', 'select,insert,update,delete'), 'future tables start closed';
  assert not has_function_privilege('authenticated', 'public.zz_future_fn()', 'execute'), 'future functions start closed';
  assert not has_function_privilege('anon', 'public.zz_future_fn()', 'execute'), 'future functions start closed for anon';
  drop function public.zz_future_fn();
  drop table public.zz_future_table;

  -- Branch configuration: Maarif operates in the application; Al Quds and Bourgogne are comparison-only.
  assert (select operates_in_app from public.branches where code = 'maarif'), 'Maarif is operational';
  assert not (select operates_in_app from public.branches where code = 'alquds'), 'Al Quds is comparison-only';
  assert not (select operates_in_app from public.branches where code = 'bourgogne'), 'Bourgogne is comparison-only';
end $$;

-- ===================================================================== 2. Catalog
do $$
declare
  n integer;
begin
  assert (select count(*) from public.permission_groups) = 6, 'six permission groups';
  assert (select count(*) from public.permission_groups where key in
    ('system_admin', 'cashier', 'storekeeper', 'manager', 'comparison_editor', 'attendance_kiosk')) = 6, 'group keys';
  assert (select count(*) from public.group_permissions where group_key = 'system_admin') = (select count(*) from public.permissions),
    'System Admin holds every permission';
  assert (select array_agg(permission_key order by permission_key) from public.group_permissions where group_key = 'comparison_editor')
    = array['comparison.enter'], 'the Comparison Editor can only enter comparison figures';
  assert (select array_agg(permission_key order by permission_key) from public.group_permissions where group_key = 'attendance_kiosk')
    = array['attendance.event.create'], 'the kiosk group holds only the attendance permission';
  assert not exists (select 1 from public.group_permissions where group_key = 'cashier' and permission_key like 'inventory.%'), 'a cashier has no inventory permission';
  assert not exists (select 1 from public.group_permissions where group_key = 'cashier' and permission_key like 'comparison.%'), 'a cashier has no comparison permission';
  assert not exists (select 1 from public.group_permissions where group_key = 'attendance_kiosk' and permission_key <> 'attendance.event.create'), 'kiosk has no other permission';
  assert (select count(*) from public.permissions where key in ('comparison.enter', 'comparison.view', 'comparison.export')) = 3,
    'comparison entry, viewing and exporting are three permissions';
  assert not exists (select 1 from public.group_permissions where group_key <> 'system_admin' and permission_key = 'comparison.export'),
    'only System Admin exports comparison data';
end $$;

-- These historical checks exercise the original RLS policy. Restore its table privileges
-- inside this roll-back-only test; Phase 4 acceptance tests check they are revoked in normal use.
grant insert, update on public.business_days to authenticated;
grant insert on public.cash_movements, public.cash_counts to authenticated;

-- ===================================================================== 3. Test helpers (rolled back)
create function public.zz_act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Runs a statement; returns the SQLSTATE of the error, or 'ok'.
create function public.zz_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

create function public.zz_msg(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

-- Rows a statement affects (UPDATE / DELETE) or returns.
create function public.zz_rows(stmt text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

create function public.zz_count(q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || q || ') s' into n;
  return n;
end $$;

grant execute on function public.zz_act_as(uuid), public.zz_try(text), public.zz_msg(text), public.zz_rows(text), public.zz_count(text) to anon, authenticated, service_role;

-- ===================================================================== 4. Setup as the database owner
-- Synthetic sign-in accounts (rows in auth.users only; no credentials are needed here).
insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-000000000001', 'admin@phase3.test'),
  ('a1000000-0000-4000-8000-000000000002', 'cashier@phase3.test'),
  ('a1000000-0000-4000-8000-000000000003', 'store@phase3.test'),
  ('a1000000-0000-4000-8000-000000000004', 'editor@phase3.test'),
  ('a1000000-0000-4000-8000-000000000005', 'manager@phase3.test'),
  ('a1000000-0000-4000-8000-000000000006', 'kiosk@phase3.test'),
  ('a1000000-0000-4000-8000-000000000007', 'multi@phase3.test'),
  ('a1000000-0000-4000-8000-000000000008', 'stranger@phase3.test'),
  ('a1000000-0000-4000-8000-000000000009', 'admin2@phase3.test'),
  ('a1000000-0000-4000-8000-00000000000a', 'outsider@phase3.test'),
  ('a1000000-0000-4000-8000-00000000000b', 'cashier-at-alquds@phase3.test');

-- A second organization that the first must never see.
insert into public.organizations (id, name) values ('00000000-0000-4000-8000-0000000000b1', 'Phase 3 other organization');
insert into public.branches (id, organization_id, code, name_en, name_ar, operates_in_app)
values ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b1', 'other_branch', 'Other', 'آخر', true);

-- Business data the policies protect: a day at the comparison-only branch Al Quds.
insert into public.business_days (id, branch_id, business_date, status)
values ('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-000000000012', '2026-11-09', 'open');

-- ===================================================================== 5. Bootstrap of the first administrator
do $$
begin
  perform public.app_bootstrap_system_admin('a1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Synthetic Admin', 'Admin@Phase3.test');
  assert (select is_active and must_change_password and email = 'admin@phase3.test' from public.staff_accounts where user_id = 'a1000000-0000-4000-8000-000000000001'),
    'bootstrap creates an active account that must change its password, with a normalized email';
  assert (select count(*) from public.staff_group_assignments where staff_id = 'a1000000-0000-4000-8000-000000000001' and group_key = 'system_admin' and branch_id is null) = 1,
    'bootstrap assigns System Admin at organization level';
  assert (select actor_name from public.audit_log where action = 'bootstrap.system_admin') = 'system', 'bootstrap is audited as a system action';

  -- Once an administrator exists the command refuses (the admin screens add more).
  assert public.zz_msg($q$select public.app_bootstrap_system_admin('a1000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000000001', 'Second', 'admin2@phase3.test')$q$) = 'admin_exists',
    'a second bootstrap is refused';
  -- It also refuses an account whose email differs from the Auth user.
  assert public.zz_msg($q$select public.app_bootstrap_system_admin('a1000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000b1', 'Outsider', 'wrong@phase3.test')$q$) = 'invalid_input',
    'bootstrap checks the email against the Auth user';
  perform public.app_bootstrap_system_admin('a1000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000b1', 'Outsider Admin', 'outsider@phase3.test');
  assert (select password_fingerprint is not null from public.staff_accounts where user_id = 'a1000000-0000-4000-8000-000000000001'),
    'a flagged account carries the fingerprint of its temporary password';
end $$;

-- ===================================================================== 5b. Temporary-password gate in the database (first sign-in)
-- The administrator has just been bootstrapped with a temporary password. Even with a valid session
-- the database authorizes nothing until the password has really been changed in Supabase Auth.
select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
do $$
begin
  assert public.app_access_context() ->> 'state' = 'active'
     and (public.app_access_context() ->> 'must_change_password')::boolean
     and jsonb_array_length(public.app_access_context() -> 'permissions') = 0,
    'a flagged person can learn their state, with no permission listed';
  assert not public.app_authorize('admin.users.manage'), 'flagged: no organization permission';
  assert not public.app_authorize('daily_close.view', 'maarif') and not public.app_authorize('comparison.export', 'alquds'), 'flagged: no branch permission';
  assert public.zz_msg($q$select public.admin_create_staff('a1000000-0000-4000-8000-000000000008', 'Evil', 'stranger@phase3.test')$q$) = 'permission_denied', 'flagged administrator: commands refused';
  assert public.zz_msg($q$select public.admin_set_staff_active('a1000000-0000-4000-8000-000000000001', false)$q$) <> 'ok', 'flagged administrator: cannot disable';
  assert public.zz_count('select 1 from public.audit_log') = 0, 'flagged: the audit history is closed';
  assert public.zz_count('select 1 from public.business_days') = 0 and public.zz_count('select 1 from public.branches') = 0
     and public.zz_count('select 1 from public.permissions') = 0 and public.zz_count('select 1 from public.group_permissions') = 0,
    'flagged: business data, branches and the catalog are closed';
  assert public.zz_try($q$insert into public.business_days (branch_id, business_date) values ('00000000-0000-4000-8000-000000000011', '2026-12-09')$q$) = '42501', 'flagged: no write';
  assert public.zz_count('select 1 from public.staff_accounts') = 1, 'flagged: their own account row stays readable';
  -- Asking to be released without having changed the password is refused and changes nothing.
  assert public.zz_msg($q$select public.app_complete_password_change()$q$) = 'password_not_changed', 'the flag cannot be cleared without a real password change';
  assert (select must_change_password from public.staff_accounts where user_id = auth.uid()), 'the flag is still set';
end $$;
reset role;
-- The trusted authentication flow stores a new password hash (simulated here by the Auth table update).
update auth.users set encrypted_password = 'hash-after-the-person-chose-a-password' where id = 'a1000000-0000-4000-8000-000000000001';
do $$
begin
  assert (select must_change_password from public.staff_accounts where user_id = 'a1000000-0000-4000-8000-000000000001'),
    'a changed hash alone does not release the account: the person must confirm';
  assert (select count(*) from public.audit_log where action = 'account.password_changed') = 0, 'nothing is audited before the confirmation';
end $$;
select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
do $$
begin
  perform public.app_complete_password_change();
  assert not (select must_change_password from public.staff_accounts where user_id = auth.uid()), 'the flag is cleared after a real change';
  assert public.app_authorize('admin.users.manage') and public.app_authorize('daily_close.view', 'maarif'), 'access works again';
  assert (select count(*) from public.audit_log where action = 'account.password_changed') = 1, 'the completion is audited once';
  perform public.app_complete_password_change();
  assert (select count(*) from public.audit_log where action = 'account.password_changed') = 1, 'asking again audits nothing more';
end $$;
reset role;
-- The other organization's administrator is released directly (setup shortcut, not under test).
update public.staff_accounts set must_change_password = false, password_fingerprint = null where user_id = 'a1000000-0000-4000-8000-00000000000a';

-- ===================================================================== 6. The administrator manages staff
select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
do $$
declare
  maarif constant text := '00000000-0000-4000-8000-000000000011';
  alquds constant text := '00000000-0000-4000-8000-000000000012';
  bourgogne constant text := '00000000-0000-4000-8000-000000000013';
begin
  assert public.app_authorize('admin.users.manage'), 'the admin may manage users';
  assert public.app_authorize('daily_close.view', 'maarif'), 'the admin views Maarif';
  assert not public.app_authorize('daily_close.view', 'alquds'), 'operational permissions do not apply to a comparison-only branch, even for the admin';
  assert public.app_authorize('comparison.enter', 'alquds'), 'the admin may enter comparison figures for Al Quds';
  assert not public.app_authorize('comparison.enter', 'maarif'), 'Maarif figures come from saved days, not comparison entry';
  assert not public.app_authorize('comparison.view', 'nowhere'), 'unknown branch is denied';
  assert not public.app_authorize('daily_close.view'), 'a branch permission asked without a branch is denied';

  -- Create staff with branch access and groups.
  perform public.admin_create_staff('a1000000-0000-4000-8000-000000000002', ' Synthetic Cashier ', 'Cashier@phase3.test', 'C-001',
    jsonb_build_object('branches', jsonb_build_array(jsonb_build_object('branch_id', maarif, 'groups', jsonb_build_array('cashier')))));
  perform public.admin_create_staff('a1000000-0000-4000-8000-000000000003', 'Synthetic Storekeeper', 'store@phase3.test', null,
    jsonb_build_object('branches', jsonb_build_array(jsonb_build_object('branch_id', maarif, 'groups', jsonb_build_array('storekeeper')))));
  perform public.admin_create_staff('a1000000-0000-4000-8000-000000000004', 'Synthetic Editor', 'editor@phase3.test', null,
    jsonb_build_object('branches', jsonb_build_array(jsonb_build_object('branch_id', alquds, 'groups', jsonb_build_array('comparison_editor')))));
  perform public.admin_create_staff('a1000000-0000-4000-8000-000000000005', 'Synthetic Manager', 'manager@phase3.test', null,
    jsonb_build_object('branches', jsonb_build_array(jsonb_build_object('branch_id', maarif, 'groups', jsonb_build_array('manager')))));
  perform public.admin_create_staff('a1000000-0000-4000-8000-000000000006', 'Synthetic Kiosk', 'kiosk@phase3.test', null,
    jsonb_build_object('branches', jsonb_build_array(jsonb_build_object('branch_id', maarif, 'groups', jsonb_build_array('attendance_kiosk')))));
  -- Several groups on one person, across branches.
  perform public.admin_create_staff('a1000000-0000-4000-8000-000000000007', 'Synthetic Multi', 'multi@phase3.test', 'M-007',
    jsonb_build_object('branches', jsonb_build_array(
      jsonb_build_object('branch_id', maarif, 'groups', jsonb_build_array('cashier', 'storekeeper')),
      jsonb_build_object('branch_id', alquds, 'groups', jsonb_build_array('comparison_editor')))));
  -- A cashier assigned at the comparison-only branch (allowed to record; grants nothing operational there).
  perform public.admin_create_staff('a1000000-0000-4000-8000-00000000000b', 'Cashier At Al Quds', 'cashier-at-alquds@phase3.test', null,
    jsonb_build_object('branches', jsonb_build_array(jsonb_build_object('branch_id', alquds, 'groups', jsonb_build_array('cashier')))));

  assert (select full_name from public.employees e join public.staff_accounts s on s.employee_id = e.id where s.user_id = 'a1000000-0000-4000-8000-000000000002') = 'Synthetic Cashier',
    'the name is trimmed';
  assert (select email from public.staff_accounts where user_id = 'a1000000-0000-4000-8000-000000000002') = 'cashier@phase3.test', 'the email is lower-cased';
  assert (select must_change_password from public.staff_accounts where user_id = 'a1000000-0000-4000-8000-000000000002'), 'a new account must change its password';
  assert (select count(*) from public.staff_group_assignments where staff_id = 'a1000000-0000-4000-8000-000000000007') = 3, 'one person holds three assignments (two groups at Maarif, one at Al Quds)';
  assert (select count(distinct group_key) from public.staff_group_assignments where staff_id = 'a1000000-0000-4000-8000-000000000007') = 3, 'three different groups on one staff member';
  assert (select count(*) from public.branch_memberships where staff_id = 'a1000000-0000-4000-8000-000000000007') = 2, 'two branch memberships';

  -- Rejected inputs.
  assert public.zz_msg($q$select public.admin_create_staff('a1000000-0000-4000-8000-000000000008', '', 'stranger@phase3.test')$q$) = 'invalid_input', 'a name is required';
  assert public.zz_msg($q$select public.admin_create_staff('a1000000-0000-4000-8000-000000000008', 'X', 'someone-else@phase3.test')$q$) = 'invalid_input', 'the email must match the Auth user';
  assert public.zz_try($q$select public.admin_create_staff('a1000000-0000-4000-8000-000000000002', 'Dup', 'cashier@phase3.test')$q$) = '23505', 'an account cannot be created twice';
  assert public.zz_try($q$select public.admin_create_staff('a1000000-0000-4000-8000-000000000008', 'Dup', 'stranger@phase3.test', 'C-001')$q$) = '23505', 'an employee number is unique in the organization';
  -- An organization group cannot be placed on a branch; a branch group needs a branch; another organization's branch is refused.
  assert public.zz_try(format($q$select public.admin_set_staff_access('a1000000-0000-4000-8000-000000000002',
      '{"branches":[{"branch_id":"%s","groups":["system_admin"]}]}'::jsonb)$q$, maarif)) = '23514', 'system_admin cannot be assigned to a branch';
  assert public.zz_try($q$select public.admin_set_staff_access('a1000000-0000-4000-8000-000000000002',
      '{"organization_groups":["cashier"]}'::jsonb)$q$) = '23514', 'a branch group cannot be assigned organization-wide';
  assert public.zz_try($q$select public.admin_set_staff_access('a1000000-0000-4000-8000-000000000002',
      '{"branches":[{"branch_id":"00000000-0000-4000-8000-0000000000b2","groups":["cashier"]}]}'::jsonb)$q$) = '23514', 'a branch of another organization is refused';
  assert public.zz_try($q$select public.admin_set_staff_access('a1000000-0000-4000-8000-000000000002',
      '{"branches":[{"branch_id":"00000000-0000-4000-8000-000000000011","groups":["not_a_group"]}]}'::jsonb)$q$) = '23503', 'an unknown group is refused';
  assert public.zz_try($q$select public.admin_set_staff_access('a1000000-0000-4000-8000-000000000002', '[]'::jsonb)$q$) = '22023', 'a malformed access document is refused';
  assert (select count(*) from public.staff_group_assignments where staff_id = 'a1000000-0000-4000-8000-000000000002') = 1, 'refused changes leave access unchanged';

  -- Update. Staff directory email must agree with the real sign-in address.
  assert public.zz_msg($q$select public.admin_update_staff('a1000000-0000-4000-8000-000000000002',
      'Synthetic Cashier', 'out-of-sync@phase3.test', null)$q$) = 'staff_email_must_match_auth',
    'an administrator cannot change only the directory email';
  assert public.admin_update_staff('a1000000-0000-4000-8000-000000000002', 'Synthetic Cashier Renamed', 'cashier@phase3.test', 'C-001'), 'update reports a change';
  assert not public.admin_update_staff('a1000000-0000-4000-8000-000000000002', 'Synthetic Cashier Renamed', 'cashier@phase3.test', 'C-001'), 'an unchanged update reports no change';
  assert public.zz_msg($q$select public.admin_update_staff('a1000000-0000-4000-8000-0000000000ff', 'X', 'x@phase3.test')$q$) = 'not_found', 'unknown staff';
  assert public.zz_msg($q$select public.admin_update_staff('a1000000-0000-4000-8000-00000000000a', 'X', 'x@phase3.test')$q$) = 'not_found', 'staff of another organization are invisible';
end $$;

-- Audit history of those changes (read as the admin through the policy).
do $$
begin
  assert (select count(*) from public.audit_log where action = 'staff.created') = 7, 'seven creations are audited';
  assert (select actor_name from public.audit_log where action = 'staff.created' order by id limit 1) = 'Synthetic Admin', 'actor recorded';
  assert (select actor_id from public.audit_log where action = 'staff.created' order by id limit 1) = 'a1000000-0000-4000-8000-000000000001', 'actor id recorded';
  assert (select changes -> 'access' -> 'groups_added' @> '[{"group":"cashier","branch":"maarif"},{"group":"storekeeper","branch":"maarif"}]'::jsonb
          from public.audit_log where action = 'staff.created' and target_id = 'a1000000-0000-4000-8000-000000000007'),
    'the creation record lists the groups assigned';
  assert (select changes -> 'before' ->> 'full_name' = 'Synthetic Cashier' and changes -> 'after' ->> 'full_name' = 'Synthetic Cashier Renamed'
          from public.audit_log where action = 'staff.updated'), 'the update record keeps before and after';
  assert not exists (select 1 from public.audit_log where changes::text ~* 'password'), 'no credential appears in an audit record';
  assert (select count(*) from public.audit_log where action = 'staff.updated') = 1, 'the unchanged update wrote no record';
end $$;

-- Change access of the multi-group person: add Manager, remove Storekeeper and the Al Quds branch.
do $$
declare
  maarif constant text := '00000000-0000-4000-8000-000000000011';
begin
  assert public.admin_set_staff_access('a1000000-0000-4000-8000-000000000007',
    jsonb_build_object('branches', jsonb_build_array(jsonb_build_object('branch_id', maarif, 'groups', jsonb_build_array('cashier', 'manager'))))), 'access change reported';
  assert (select count(*) from public.branch_memberships where staff_id = 'a1000000-0000-4000-8000-000000000007') = 1, 'the Al Quds membership was removed';
  assert (select array_agg(group_key order by group_key) from public.staff_group_assignments where staff_id = 'a1000000-0000-4000-8000-000000000007') = array['cashier', 'manager'],
    'groups now cashier + manager';
  assert (select changes -> 'groups_removed' @> '[{"group":"storekeeper","branch":"maarif"},{"group":"comparison_editor","branch":"alquds"}]'::jsonb
            and changes -> 'groups_added' @> '[{"group":"manager","branch":"maarif"}]'::jsonb
            and changes -> 'branches_removed' @> '["alquds"]'::jsonb
          from public.audit_log where action = 'staff.access_changed' and target_id = 'a1000000-0000-4000-8000-000000000007'),
    'the access record lists added and removed groups and branches';
  assert not public.admin_set_staff_access('a1000000-0000-4000-8000-000000000007',
    jsonb_build_object('branches', jsonb_build_array(jsonb_build_object('branch_id', maarif, 'groups', jsonb_build_array('manager', 'cashier'))))), 'the same access again is no change';
  assert (select count(*) from public.audit_log where action = 'staff.access_changed') = 1, 'no record for an unchanged set';
end $$;

-- Disable and reactivate, with the open sessions of the disabled person removed.
reset role;
insert into auth.sessions (id, user_id) values ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000007');
select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
do $$
begin
  assert public.admin_set_staff_active('a1000000-0000-4000-8000-000000000007', false, '  left the shift  '), 'disable reported';
  assert not (select is_active from public.staff_accounts where user_id = 'a1000000-0000-4000-8000-000000000007'), 'disabled';
  assert not (select e.is_active from public.employees e join public.staff_accounts s on s.employee_id = e.id where s.user_id = 'a1000000-0000-4000-8000-000000000007'), 'the employee is inactive too';
  assert (select disabled_reason from public.staff_accounts where user_id = 'a1000000-0000-4000-8000-000000000007') = 'left the shift', 'reason recorded';
  assert not public.admin_set_staff_active('a1000000-0000-4000-8000-000000000007', false, 'again'), 'disabling twice changes nothing';
  assert (select count(*) from public.audit_log where action = 'staff.disabled') = 1, 'one disable record';
  assert (select changes ->> 'reason' from public.audit_log where action = 'staff.disabled') = 'left the shift', 'reason audited';

  assert public.zz_msg($q$select public.admin_set_staff_active('a1000000-0000-4000-8000-000000000001', false)$q$) = 'self_disable', 'an admin cannot disable themselves';
end $$;
reset role;
do $$
begin
  assert not exists (select 1 from auth.sessions where user_id = 'a1000000-0000-4000-8000-000000000007'), 'open sessions of a disabled account were removed';
end $$;
select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
do $$
begin
  assert public.admin_set_staff_active('a1000000-0000-4000-8000-000000000007', true), 'reactivate reported';
  assert (select is_active and disabled_at is null and disabled_reason is null from public.staff_accounts where user_id = 'a1000000-0000-4000-8000-000000000007'), 'reactivated';
  assert (select count(*) from public.audit_log where action = 'staff.reactivated') = 1, 'one reactivation record';
  -- Access survives a disable/reactivate cycle.
  assert (select count(*) from public.staff_group_assignments where staff_id = 'a1000000-0000-4000-8000-000000000007') = 2, 'groups kept';

  -- The last administrator.
  assert public.zz_msg($q$select public.admin_set_staff_access('a1000000-0000-4000-8000-000000000001', '{}'::jsonb)$q$) = 'last_admin', 'the last System Admin cannot lose the group';
  perform public.admin_create_staff('a1000000-0000-4000-8000-000000000009', 'Second Admin', 'admin2@phase3.test', null, '{"organization_groups":["system_admin"]}'::jsonb);
  assert public.admin_set_staff_access('a1000000-0000-4000-8000-000000000001', '{}'::jsonb), 'with a second admin the first can be demoted';
end $$;
reset role;

-- The demoted first admin is now only a person with no access; hand the group back through the second admin.
-- (Setup shortcut: the second admin has chosen a password already; the real gate is tested in 5b and 6b.)
update public.staff_accounts set must_change_password = false, password_fingerprint = null where user_id = 'a1000000-0000-4000-8000-000000000009';
select public.zz_act_as('a1000000-0000-4000-8000-000000000009');
do $$
begin
  assert public.app_authorize('admin.users.manage'), 'the second admin manages users';
  assert public.admin_set_staff_access('a1000000-0000-4000-8000-000000000001', '{"organization_groups":["system_admin"]}'::jsonb), 'restored';
  assert public.zz_msg($q$select public.admin_set_staff_active('a1000000-0000-4000-8000-000000000001', false)$q$) = 'ok', 'another admin can disable the first';
  assert public.admin_set_staff_active('a1000000-0000-4000-8000-000000000001', true), 'and reactivate';
end $$;
reset role;

-- ===================================================================== 6b. Temporary-password gate for staff: first sign-in and administrator reset
-- The cashier was created in section 6 and has not chosen a password yet.
select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
begin
  assert not public.app_authorize('daily_close.view', 'maarif') and not public.app_authorize('cash_count.enter', 'maarif'), 'new account: no permission before the password is chosen';
  assert public.zz_count('select 1 from public.business_days') = 0 and public.zz_count('select 1 from public.branches') = 0, 'new account: no row is readable';
  assert public.zz_try($q$insert into public.business_days (branch_id, business_date) values ('00000000-0000-4000-8000-000000000011', '2026-12-08')$q$) = '42501', 'new account: no write';
  assert jsonb_array_length(public.app_access_context() -> 'permissions') = 0, 'new account: the context lists no permission';
  assert public.zz_msg($q$select public.app_complete_password_change()$q$) = 'password_not_changed', 'new account: cannot release itself';
end $$;
reset role;
update auth.users set encrypted_password = 'cashier-chose-a-password' where id = 'a1000000-0000-4000-8000-000000000002';
select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
begin
  perform public.app_complete_password_change();
  assert public.app_authorize('daily_close.view', 'maarif') and public.zz_count('select 1 from public.business_days') = 10, 'after the real change the cashier works';
end $$;
reset role;

-- The administrator issues a new temporary password: the server sets it in Auth first, then records it.
update auth.users set encrypted_password = 'temporary-password-issued-by-admin' where id = 'a1000000-0000-4000-8000-000000000002';
select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
select public.admin_record_password_reset('a1000000-0000-4000-8000-000000000002');
reset role;
select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
begin
  -- The same open session is blocked on its very next statement.
  assert not public.app_authorize('daily_close.view', 'maarif') and public.zz_count('select 1 from public.business_days') = 0, 'after an administrator reset the open session is blocked at once';
  assert public.zz_msg($q$select public.app_complete_password_change()$q$) = 'password_not_changed', 'the temporary password itself does not release the account';
end $$;
reset role;
update auth.users set encrypted_password = 'cashier-chose-another-password' where id = 'a1000000-0000-4000-8000-000000000002';
select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
begin
  perform public.app_complete_password_change();
  assert public.app_authorize('daily_close.view', 'maarif'), 'released after the second real change';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.audit_log where action = 'account.password_changed' and target_id = 'a1000000-0000-4000-8000-000000000002') = 2, 'both completions are audited';
  assert (select count(*) from public.audit_log where action = 'staff.password_reset_issued' and target_id = 'a1000000-0000-4000-8000-000000000002') = 1, 'the reset is audited';
  -- Setup shortcut for the sections below: the other staff have chosen their passwords.
  update public.staff_accounts set must_change_password = false, password_fingerprint = null where must_change_password;
end $$;

-- ===================================================================== 7. Staff cannot manage staff or touch identity tables
select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
begin
  assert public.zz_msg($q$select public.admin_create_staff('a1000000-0000-4000-8000-000000000008', 'Evil', 'stranger@phase3.test')$q$) = 'permission_denied', 'a cashier cannot create staff';
  assert public.zz_msg($q$select public.admin_set_staff_access('a1000000-0000-4000-8000-000000000002', '{"organization_groups":["system_admin"]}'::jsonb)$q$) = 'permission_denied', 'a cashier cannot grant themselves System Admin';
  assert public.zz_msg($q$select public.admin_set_staff_active('a1000000-0000-4000-8000-000000000003', false)$q$) = 'permission_denied', 'a cashier cannot disable staff';
  assert public.zz_msg($q$select public.admin_update_staff('a1000000-0000-4000-8000-000000000002', 'Boss', 'cashier@phase3.test')$q$) = 'permission_denied', 'a cashier cannot rename themselves through the admin command';
  assert public.zz_msg($q$select public.admin_record_password_reset('a1000000-0000-4000-8000-000000000003')$q$) = 'permission_denied', 'a cashier cannot reset passwords';
  assert public.zz_try($q$insert into public.staff_group_assignments (staff_id, group_key) values ('a1000000-0000-4000-8000-000000000002', 'system_admin')$q$) = '42501', 'no direct insert into assignments';
  assert public.zz_try($q$update public.staff_accounts set is_active = true where user_id = 'a1000000-0000-4000-8000-000000000002'$q$) = '42501', 'no direct update of accounts';
  assert public.zz_try($q$delete from public.branch_memberships$q$) = '42501', 'no direct delete of memberships';
  assert public.zz_try($q$insert into public.audit_log (actor_name, category, action, target_type) values ('x', 'operation', 'a.b', 'c')$q$) = '42501', 'no direct audit insert';
  assert public.zz_try($q$select app_private.write_audit(null, 'operation', 'a.b', 'c', null, null, null, '{}')$q$) = '42501', 'the audit writer is not callable';
  assert public.zz_try($q$select public.app_bootstrap_system_admin('a1000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000000001', 'X', 'stranger@phase3.test')$q$) = '42501', 'the bootstrap command is closed to staff';
  -- The cashier sees only their own identity rows and no audit history.
  assert public.zz_count('select 1 from public.staff_accounts') = 1, 'a cashier reads only their own account';
  assert public.zz_count('select 1 from public.employees') = 1, 'a cashier reads only their own employee record';
  assert public.zz_count('select 1 from public.staff_group_assignments') = 1, 'a cashier reads only their own assignments';
  assert public.zz_count('select 1 from public.audit_log') = 0, 'a cashier cannot read the audit history';
  assert public.zz_count('select 1 from public.branches') = 1, 'a cashier sees only their own branch';
end $$;
reset role;

-- ===================================================================== 8. Cashier: assigned workflows and denials
select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
declare
  maarif constant text := '00000000-0000-4000-8000-000000000011';
  alquds constant text := '00000000-0000-4000-8000-000000000012';
begin
  -- Assigned workflow at Maarif.
  assert public.app_authorize('daily_close.view', 'maarif') and public.app_authorize('daily_close.draft', 'maarif')
     and public.app_authorize('cash_count.enter', 'maarif') and public.app_authorize('daily_close.export_draft', 'maarif'), 'the cashier holds the cashier permissions at Maarif';
  assert public.zz_count('select 1 from public.business_days') = 10, 'the cashier reads the ten Maarif days and not the Al Quds day';
  assert public.zz_count(format('select 1 from public.business_days where branch_id = %L', alquds)) = 0, 'no row of another branch is visible';
  assert public.zz_try(format($q$insert into public.business_days (branch_id, business_date) values (%L, '2026-12-01')$q$, maarif)) = 'ok', 'a draft day at Maarif is accepted';
  assert public.zz_try(format($q$insert into public.business_days (branch_id, business_date) values (%L, '2026-12-02')$q$, alquds)) = '42501', 'a draft day for another branch is refused';
  assert public.zz_rows(format($q$update public.business_days set net_sales = 10 where branch_id = %L and business_date = '2026-12-01'$q$, maarif)) = 1, 'the cashier edits an open draft';
  assert public.zz_try(format($q$update public.business_days set status = 'closed', net_sales = 10, closed_at = now() where branch_id = %L and business_date = '2026-12-01'$q$, maarif)) = '42501',
    'a cashier cannot close a day';
  assert public.zz_rows($q$update public.business_days set net_sales = 1 where business_date = '2026-11-02'$q$) = 0, 'a cashier cannot change a closed day';
  assert public.zz_rows(format($q$update public.business_days set net_sales = 1 where branch_id = %L$q$, alquds)) = 0, 'a cashier cannot change another branch';
  assert public.zz_try($q$insert into public.cash_movements (business_day_id, kind, amount, occurred_at)
    select id, 'expense', 5, now() from public.business_days where business_date = '2026-12-01'$q$) = 'ok', 'an expense on the open draft is accepted';
  assert public.zz_try($q$insert into public.cash_movements (business_day_id, kind, amount, occurred_at)
    values ('00000000-0000-4000-8000-000000000102', 'expense', 5, now())$q$) = '42501', 'an expense on a closed day is refused';
  assert public.zz_try($q$insert into public.cash_movements (business_day_id, kind, amount, occurred_at)
    values ('00000000-0000-4000-8000-0000000009a1', 'expense', 5, now())$q$) = '42501', 'an expense on another branch is refused';
  assert public.zz_try($q$insert into public.cash_counts (business_day_id, counted_amount, counted_at, calc_version)
    values ('00000000-0000-4000-8000-000000000108', 100, now(), 'test')$q$) = 'ok', 'the cashier records a cash count';
  assert public.zz_try($q$insert into public.cash_counts (business_day_id, counted_amount, counted_at, calc_version)
    values ('00000000-0000-4000-8000-0000000009a1', 100, now(), 'test')$q$) = '42501', 'a cash count for another branch is refused';
  assert public.zz_try($q$update public.cash_counts set counted_amount = 1$q$) = '42501', 'a saved count cannot be edited';
  assert public.zz_try($q$delete from public.cash_counts$q$) = '42501', 'a saved count cannot be deleted';

  -- Inventory adjustments: denied.
  assert not public.app_authorize('inventory.adjust', 'maarif'), 'the cashier cannot adjust inventory';
  assert public.zz_try(format($q$insert into public.inventory_adjustments (branch_id, business_date, reason) values (%L, '2026-11-02', 'recount')$q$, maarif)) = '42501',
    'database policy refuses an inventory adjustment by a cashier';
  assert public.zz_count('select 1 from public.inventory_adjustments') = 0, 'a cashier reads no adjustment';

  -- Comparison data: no entry, no view, no export.
  assert public.zz_count('select 1 from public.comparison_figures') = 0, 'a cashier reads no comparison figure';
  assert public.zz_count(format('select 1 from public.branch_daily_figures where branch_id <> %L', maarif)) = 0, 'through the combined view a cashier sees only the closed days of their own branch';
  assert public.zz_try(format($q$insert into public.comparison_figures (branch_id, business_date, net_sales) values (%L, '2026-12-01', 5)$q$, alquds)) = '42501', 'a cashier cannot enter comparison figures';
  assert not public.app_authorize('comparison.view', 'alquds') and not public.app_authorize('comparison.export', 'alquds'), 'no comparison permission';
  assert not public.app_authorize('reports.export', 'maarif'), 'the cashier cannot export reports';
end $$;
reset role;

-- The cashier's operating actions are in the audit history, with the cashier as the actor.
do $$
begin
  assert (select count(*) from public.audit_log where action = 'business_days.created' and actor_name = 'Synthetic Cashier Renamed') = 1, 'the draft creation is audited';
  assert (select changes -> 'after' ->> 'net_sales' = '10.00' or changes -> 'after' ->> 'net_sales' = '10' from public.audit_log where action = 'business_days.updated' and actor_name = 'Synthetic Cashier Renamed'),
    'the draft update is audited with the changed field';
  assert (select count(*) from public.audit_log where action = 'cash_movements.created') = 1, 'the expense is audited';
  assert (select count(*) from public.audit_log where action = 'cash_counts.created') = 1, 'the count is audited';
  assert (select branch_id from public.audit_log where action = 'cash_counts.created') = '00000000-0000-4000-8000-000000000011', 'the branch of a count is recorded';
end $$;

-- ===================================================================== 9. Cashier assigned to a comparison-only branch
select public.zz_act_as('a1000000-0000-4000-8000-00000000000b');
do $$
declare
  alquds constant text := '00000000-0000-4000-8000-000000000012';
begin
  assert not public.app_authorize('daily_close.view', 'alquds'), 'the cashier role does nothing at a comparison-only branch';
  assert public.zz_count('select 1 from public.business_days') = 0, 'no day is visible';
  assert public.zz_try(format($q$insert into public.business_days (branch_id, business_date) values (%L, '2026-12-03')$q$, alquds)) = '42501', 'no day can be created at a comparison-only branch';
  assert public.zz_count('select 1 from public.branches') = 1, 'the person sees only the branch they belong to';
end $$;
reset role;

-- ===================================================================== 10. Storekeeper, manager, kiosk
select public.zz_act_as('a1000000-0000-4000-8000-000000000003');
do $$
declare
  maarif constant text := '00000000-0000-4000-8000-000000000011';
  alquds constant text := '00000000-0000-4000-8000-000000000012';
begin
  assert public.app_authorize('inventory.adjust', 'maarif') and public.app_authorize('inventory.receive', 'maarif') and public.app_authorize('purchase_order.propose', 'maarif'), 'storekeeper permissions';
  assert not public.app_authorize('daily_close.view', 'maarif'), 'a storekeeper has no daily-close access';
  assert public.zz_count('select 1 from public.business_days') = 0, 'and sees no day';
  assert public.zz_try(format($q$insert into public.inventory_adjustments (branch_id, business_date, reason) values (%L, '2026-11-02', 'recount')$q$, maarif)) = 'ok', 'the storekeeper records an adjustment';
  assert public.zz_try(format($q$insert into public.inventory_adjustments (branch_id, business_date, reason) values (%L, '2026-11-02', 'recount')$q$, alquds)) = '42501', 'not at another branch';
  assert public.zz_try(format($q$insert into public.inventory_adjustments (branch_id, business_date, reason, created_by) values (%L, '2026-11-02', 'x', 'a1000000-0000-4000-8000-000000000002')$q$, maarif)) = '42501', 'not in another person''s name';
  assert public.zz_count('select 1 from public.inventory_adjustments') = 1, 'the storekeeper reads the adjustment';
  assert public.zz_try('update public.inventory_adjustments set reason = ''edited''') = '42501', 'adjustments cannot be edited';
  assert not public.app_authorize('inventory.adjust_approve', 'maarif'), 'a storekeeper cannot approve adjustments';
end $$;
reset role;

select public.zz_act_as('a1000000-0000-4000-8000-000000000005');
do $$
declare
  maarif constant text := '00000000-0000-4000-8000-000000000011';
begin
  assert public.app_authorize('daily_close.close', 'maarif') and public.app_authorize('inventory.adjust_approve', 'maarif'), 'manager permissions';
  assert public.zz_rows(format($q$update public.business_days set status = 'closed', net_sales = 10, closed_at = now() where branch_id = %L and business_date = '2026-12-01'$q$, maarif)) = 1,
    'a manager closes the draft day';
  assert public.zz_try(format($q$insert into public.inventory_adjustments (branch_id, business_date, reason) values (%L, '2026-11-02', 'x')$q$, maarif)) = '42501', 'a manager approves but does not record adjustments';
  assert public.app_authorize('comparison.view', 'maarif'), 'a manager may view comparison figures of their own branch';
  assert not public.app_authorize('comparison.view', 'alquds'), 'but only for the branches they belong to';
  assert not public.app_authorize('comparison.export', 'maarif'), 'and cannot export them';
end $$;
reset role;

select public.zz_act_as('a1000000-0000-4000-8000-000000000006');
do $$
declare
  maarif constant text := '00000000-0000-4000-8000-000000000011';
begin
  assert public.app_authorize('attendance.event.create', 'maarif'), 'the kiosk may create attendance events at its own branch';
  assert not public.app_authorize('attendance.event.create', 'alquds'), 'and not elsewhere';
  assert not public.app_authorize('daily_close.view', 'maarif') and not public.app_authorize('inventory.view', 'maarif') and not public.app_authorize('reports.view', 'maarif'), 'the kiosk reaches no financial or inventory screen';
  assert public.zz_count('select 1 from public.business_days') = 0 and public.zz_count('select 1 from public.cash_counts') = 0, 'and reads no financial row';
  assert public.zz_try(format($q$insert into public.inventory_adjustments (branch_id, business_date, reason) values (%L, '2026-11-02', 'x')$q$, maarif)) = '42501', 'nor writes inventory';
end $$;
reset role;

-- ===================================================================== 11. Comparison entry, viewing and exporting are separate
select public.zz_act_as('a1000000-0000-4000-8000-000000000004');
do $$
declare
  maarif constant text := '00000000-0000-4000-8000-000000000011';
  alquds constant text := '00000000-0000-4000-8000-000000000012';
  bourgogne constant text := '00000000-0000-4000-8000-000000000013';
begin
  assert public.app_authorize('comparison.enter', 'alquds'), 'the editor enters Al Quds figures';
  assert not public.app_authorize('comparison.enter', 'bourgogne'), 'but not for an unassigned branch';
  assert not public.app_authorize('comparison.enter', 'maarif'), 'nor for the operating branch';
  assert not public.app_authorize('comparison.view', 'alquds'), 'entry does not grant viewing';
  assert not public.app_authorize('comparison.export', 'alquds'), 'entry does not grant exporting';
  assert public.zz_try(format($q$insert into public.comparison_figures (branch_id, business_date, net_sales) values (%L, '2026-11-17', 77)$q$, alquds)) = 'ok', 'the editor saves a figure';
  assert public.zz_try(format($q$insert into public.comparison_figures (branch_id, business_date, net_sales) values (%L, '2026-11-17', 77)$q$, bourgogne)) = '42501', 'not for an unassigned branch (database policy)';
  assert public.zz_try(format($q$insert into public.comparison_figures (branch_id, business_date, net_sales) values (%L, '2026-11-17', 77)$q$, maarif)) = '42501', 'not for the operating branch (database policy)';
  assert public.zz_count('select 1 from public.comparison_figures') = 0, 'the editor cannot read what exists, even their own figure';
  assert public.zz_count('select 1 from public.branch_daily_figures') = 0, 'the view shows the editor nothing';
  assert public.zz_try($q$update public.comparison_figures set net_sales = 1$q$) = '42501', 'no update through the API';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.audit_log where action = 'comparison_figures.created' and actor_name = 'Synthetic Editor') = 1, 'the figure entry is audited';
  assert (select net_sales from public.comparison_figures where branch_id = '00000000-0000-4000-8000-000000000012' and business_date = '2026-11-17') = 77, 'the figure exists';
end $$;

select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
do $$
begin
  assert public.app_authorize('comparison.view', 'alquds') and public.app_authorize('comparison.view', 'bourgogne') and public.app_authorize('comparison.view', 'maarif'), 'the admin views all three';
  assert public.app_authorize('comparison.export', 'alquds'), 'and exports';
  assert public.zz_count('select 1 from public.comparison_figures') = 4, 'the admin reads the four stored figures';
  assert public.zz_count('select 1 from public.branch_daily_figures') > 0, 'and the combined view';
  assert public.zz_count('select 1 from public.branches') = 3, 'the admin sees the three branches of their organization and not the other organization';
  assert public.zz_count('select 1 from public.staff_accounts') = 9, 'the admin reads the nine accounts of their organization, not the other one';
  assert public.zz_count('select 1 from public.staff_accounts where email = ''outsider@phase3.test''') = 0, 'another organization is invisible';
  assert public.zz_try(format($q$insert into public.comparison_figures (branch_id, business_date, net_sales) values ('00000000-0000-4000-8000-000000000011', '2026-11-18', 5)$q$)) = '42501', 'even the admin cannot enter a figure for the operating branch';
end $$;
reset role;

-- ===================================================================== 12. Changes take effect on the very next statement
-- The cashier's session (same claims throughout). Permission removed, then restored; then disabled.
select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
begin
  assert public.app_authorize('daily_close.view', 'maarif') and public.zz_count('select 1 from public.business_days') > 0, 'before: access';
end $$;
reset role;

select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
select public.admin_set_staff_access('a1000000-0000-4000-8000-000000000002', '{"branches":[{"branch_id":"00000000-0000-4000-8000-000000000011","groups":[]}]}'::jsonb);
reset role;

select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
begin
  assert not public.app_authorize('daily_close.view', 'maarif'), 'after removing the group: not authorized';
  assert public.zz_count('select 1 from public.business_days') = 0, 'after removing the group: no row is readable';
  assert public.zz_try($q$insert into public.business_days (branch_id, business_date) values ('00000000-0000-4000-8000-000000000011', '2026-12-05')$q$) = '42501', 'after removing the group: no write';
  assert public.app_access_context() ->> 'state' = 'active', 'the account itself is still active';
  assert jsonb_array_length(public.app_access_context() -> 'permissions') = 0, 'the context lists no permission';
  assert public.zz_count('select 1 from public.branches') = 1, 'the branch membership remains';
end $$;
reset role;

select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
select public.admin_set_staff_access('a1000000-0000-4000-8000-000000000002', '{"branches":[{"branch_id":"00000000-0000-4000-8000-000000000011","groups":["cashier"]}]}'::jsonb);
reset role;
select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
begin
  assert public.app_authorize('daily_close.view', 'maarif') and public.zz_count('select 1 from public.business_days') > 0, 'after restoring: access is back';
end $$;
reset role;

select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
select public.admin_set_staff_active('a1000000-0000-4000-8000-000000000002', false, 'test');
reset role;
select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
begin
  assert public.app_access_context() ->> 'state' = 'disabled', 'a disabled account is reported as disabled';
  assert not public.app_authorize('daily_close.view', 'maarif'), 'disabled: not authorized';
  assert public.zz_count('select 1 from public.business_days') = 0, 'disabled: no row readable';
  assert public.zz_count('select 1 from public.staff_accounts') = 0, 'disabled: not even their own account row';
  assert public.zz_count('select 1 from public.branches') = 0 and public.zz_count('select 1 from public.permissions') = 0, 'disabled: nothing else readable';
  assert public.zz_try($q$insert into public.business_days (branch_id, business_date) values ('00000000-0000-4000-8000-000000000011', '2026-12-06')$q$) = '42501', 'disabled: no write';
  assert public.zz_msg($q$select public.app_complete_password_change()$q$) = 'permission_denied', 'disabled: no self-service command';
end $$;
reset role;

select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
select public.admin_set_staff_active('a1000000-0000-4000-8000-000000000002', true);
reset role;
select public.zz_act_as('a1000000-0000-4000-8000-000000000002');
do $$
begin
  assert public.app_authorize('daily_close.view', 'maarif'), 'reactivated: access again';
  -- Disabling and reactivating does not change the password requirement (tested in 5b and 6b).
  assert not (select must_change_password from public.staff_accounts where user_id = auth.uid()), 'the cashier chose a password earlier';
end $$;
reset role;
do $$
begin
  assert (select count(*) from public.audit_log where action = 'account.password_changed') = 3, 'three completions in total: the administrator and the cashier twice';
end $$;

-- An authenticated person with no staff record at all.
select public.zz_act_as('a1000000-0000-4000-8000-000000000008');
do $$
begin
  assert public.app_access_context() ->> 'state' = 'unregistered', 'an unregistered user is reported as such';
  assert public.zz_count('select 1 from public.business_days') = 0 and public.zz_count('select 1 from public.branches') = 0
     and public.zz_count('select 1 from public.organizations') = 0 and public.zz_count('select 1 from public.permissions') = 0, 'and reads nothing';
  assert not public.app_authorize('admin.users.manage'), 'and holds no permission';
end $$;
reset role;

-- ===================================================================== 13. Administrator of another organization
select public.zz_act_as('a1000000-0000-4000-8000-00000000000a');
do $$
begin
  assert public.app_authorize('admin.users.manage'), 'the outsider administers their own organization';
  assert public.zz_count('select 1 from public.staff_accounts') = 1, 'and sees only it';
  assert public.zz_count('select 1 from public.audit_log') = 1, 'only their own audit records';
  assert public.zz_count('select 1 from public.business_days') = 0, 'and no business day of the other organization';
  assert public.zz_msg($q$select public.admin_set_staff_active('a1000000-0000-4000-8000-000000000003', false)$q$) = 'not_found', 'cannot disable a person of another organization';
  assert public.zz_msg($q$select public.admin_set_staff_access('a1000000-0000-4000-8000-000000000003', '{}'::jsonb)$q$) = 'not_found', 'cannot change their access either';
end $$;
reset role;

-- ===================================================================== 14. The audit history is append-only
select public.zz_act_as('a1000000-0000-4000-8000-000000000001');
do $$
begin
  assert public.app_authorize('admin.audit.view'), 'the admin reviews the audit history';
  assert public.zz_count('select 1 from public.audit_log') >= 20, 'and reads it';
  assert public.zz_try('update public.audit_log set actor_name = ''x''') = '42501', 'the admin cannot update an audit record';
  assert public.zz_try('delete from public.audit_log') = '42501', 'the admin cannot delete an audit record';
  assert public.zz_try('truncate public.audit_log') = '42501', 'the admin cannot truncate the audit history';
  assert public.zz_try($q$insert into public.audit_log (actor_name, category, action, target_type) values ('x', 'operation', 'a.b', 'c')$q$) = '42501', 'the admin cannot forge an audit record';
end $$;
reset role;

do $$
begin
  -- The table owner and the service role are also refused (trigger and grants).
  assert public.zz_try('update public.audit_log set actor_name = ''x''') = '42501', 'the owner cannot update an audit record (trigger)';
  assert public.zz_try('delete from public.audit_log') = '42501', 'the owner cannot delete an audit record (trigger)';
  assert public.zz_try('truncate public.audit_log') = '42501', 'the owner cannot truncate the audit history (trigger)';
  assert public.zz_try($q$insert into public.audit_log (actor_name, category, action, target_type, changes) values ('x', 'operation', 'a.b', 'c', '{"password":"hunter2"}')$q$) = '23514', 'a credential-like field is refused in the audit record';
  assert public.zz_try($q$insert into public.audit_log (actor_name, category, action, target_type, changes) values ('x', 'operation', 'a.b', 'c', '{"nested":{"api_key":"x"}}')$q$) = '23514', 'also nested';
  assert public.zz_try($q$insert into public.audit_log (actor_name, category, action, target_type, changes) values ('x', 'operation', 'a.b', 'c', '{"reason":"the password was reset"}')$q$) = 'ok', 'free text mentioning a password is allowed';
end $$;
set local role service_role;
do $$
begin
  assert public.zz_try('update public.audit_log set actor_name = ''x''') = '42501', 'the service role cannot update an audit record';
  assert public.zz_try('delete from public.audit_log') = '42501', 'the service role cannot delete an audit record';
  assert public.zz_try($q$insert into public.audit_log (actor_name, category, action, target_type) values ('x', 'operation', 'a.b', 'c')$q$) = '42501', 'the service role cannot write the audit history directly';
end $$;
reset role;

-- Anonymous visitors still read nothing.
set local role anon;
do $$
begin
  assert public.zz_try('select 1 from public.audit_log') = '42501', 'anon cannot read the audit history';
  assert public.zz_try('select 1 from public.staff_accounts') = '42501', 'anon cannot read accounts';
  assert public.zz_try($q$select public.app_authorize('daily_close.view', 'maarif')$q$) = '42501', 'anon cannot ask for authorization';
  assert public.zz_try($q$select public.admin_set_staff_active('a1000000-0000-4000-8000-000000000003', false)$q$) = '42501', 'anon cannot call a command';
end $$;
reset role;

rollback;

select 'phase3 database checks passed' as result;
