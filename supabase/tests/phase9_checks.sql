-- Phase 9 acceptance cases for Excel exports: the record, the permissions of each report family for
-- every branch, period validation, one export per request, claim / complete / fail / retry with exactly
-- one completed file, completion only after the file is stored, frozen completed exports, private
-- storage, and downloads refused after a permission is removed. Synthetic people only; every change
-- rolls back. The Storage upload is simulated by inserting the object row (the HTTP check uploads a
-- real file through the Storage API).
begin;

create function public.phase9_act_as(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then reset role; return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$;
grant execute on function public.phase9_act_as(uuid) to authenticated;

create function public.phase9_expect(p_state text, p_sql text) returns void language plpgsql as $$
declare got text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics got = returned_sqlstate;
    if got <> p_state then raise exception 'expected SQLSTATE % but got % (%) for: %', p_state, got, sqlerrm, left(p_sql, 300); end if;
    return;
  end;
  raise exception 'expected SQLSTATE % but the statement succeeded: %', p_state, left(p_sql, 300);
end;
$$;
grant execute on function public.phase9_expect(text, text) to authenticated, anon;

-- Stores a simulated upload (as the table owner, like the Storage service would after its policy check).
create function public.phase9_store(p_name text, p_size bigint) returns void language sql security definer set search_path = '' as $$
  insert into storage.objects (bucket_id, name, metadata) values ('report-exports', p_name, jsonb_build_object('size', p_size, 'mimetype',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
$$;
grant execute on function public.phase9_store(text, bigint) to authenticated;

create function public.phase9_complete(p_export uuid, p_attempt integer, p_bytes bigint default 1000) returns jsonb language sql as $$
  select public.app_report_export_complete(p_export, p_attempt, 'test-file.xlsx', repeat('a', 64), p_bytes, 'daily_sales@1.0.0',
    'p9-calc-test', '{"operating_basis": 0}'::jsonb, repeat('b', 64));
$$;
grant execute on function public.phase9_complete(uuid, integer, bigint) to authenticated;

-- Test-only groups: comparison export for one branch, and reports export without draft export.
insert into public.permission_groups (key, description, scope) values
  ('pnine_cmp', 'test only: comparison.export', 'branch'),
  ('pnine_reports', 'test only: reports.export + daily_close.view', 'branch');
insert into public.group_permissions (group_key, permission_key) values
  ('pnine_cmp', 'comparison.export'), ('pnine_reports', 'reports.export'), ('pnine_reports', 'daily_close.view');

insert into auth.users(id, email) values
  ('a9000000-0000-4000-8000-000000000001', 'admin@phase9.test'),
  ('a9000000-0000-4000-8000-000000000002', 'admin2@phase9.test'),
  ('a9000000-0000-4000-8000-000000000003', 'manager@phase9.test'),
  ('a9000000-0000-4000-8000-000000000004', 'cashier@phase9.test'),
  ('a9000000-0000-4000-8000-000000000005', 'cmp@phase9.test'),
  ('a9000000-0000-4000-8000-000000000006', 'reports@phase9.test');
insert into public.employees(id, organization_id, full_name)
  select u.id, b.organization_id, 'P9 ' || split_part(u.email, '@', 1) from auth.users u cross join public.branches b
  where b.code = 'maarif' and u.email like '%@phase9.test';
insert into public.staff_accounts(user_id, employee_id, organization_id, email)
  select u.id, u.id, e.organization_id, u.email from auth.users u join public.employees e on e.id = u.id where u.email like '%@phase9.test';
insert into public.branch_memberships(staff_id, branch_id)
  select u.id, b.id from auth.users u cross join public.branches b
  where b.code in ('maarif', 'alquds') and u.email like '%@phase9.test';
insert into public.staff_group_assignments(staff_id, branch_id, group_key)
  select u.id, case when g in ('system_admin') then null else b.id end, g
  from (values ('admin', 'system_admin'), ('admin2', 'system_admin'), ('manager', 'manager'), ('cashier', 'cashier'), ('reports', 'pnine_reports')) v(who, g)
  join auth.users u on u.email = v.who || '@phase9.test'
  join public.branches b on b.code = 'maarif';
-- comparison.export for Al Quds only.
insert into public.staff_group_assignments(staff_id, branch_id, group_key)
  select 'a9000000-0000-4000-8000-000000000005', b.id, 'pnine_cmp' from public.branches b where b.code = 'alquds';

-- ------------------------------------------------------------------ 1. structure, private storage
do $$
begin
  assert (select bool_and(relrowsecurity) from pg_class where oid in ('public.report_exports'::regclass, 'public.report_export_events'::regclass)),
    'row-level security on both tables';
  assert not has_table_privilege('authenticated', 'public.report_exports', 'insert')
     and not has_table_privilege('authenticated', 'public.report_exports', 'update')
     and not has_table_privilege('authenticated', 'public.report_export_events', 'insert')
     and not has_table_privilege('anon', 'public.report_exports', 'select'), 'the API roles can only read';
  assert not has_function_privilege('anon', 'public.app_report_export_request(text, text[], jsonb, text, boolean, uuid)', 'execute'), 'anon cannot request';
  assert not has_table_privilege('authenticated', 'app_private.report_export_owners', 'insert,update,delete'), 'staff cannot appoint an exporter';
  assert (select not public from storage.buckets where id = 'report-exports'), 'the bucket is private';
  assert (select file_size_limit = 26214400 and allowed_mime_types = array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
          from storage.buckets where id = 'report-exports'), 'size limit and xlsx only';
  assert (select array_agg(cmd::text order by cmd) from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname like 'report_exports_%') = array['INSERT', 'SELECT'], 'upload and read policies only: no update, no delete';
  assert app_private.report_export_requirements('sales_comparison', false) = array['comparison.export'];
  assert app_private.report_export_requirements('daily_ledger', true) = array['reports.export', 'daily_close.view', 'daily_close.export_draft'];
  assert app_private.report_export_requirements('inventory', false) = array['reports.export', 'inventory.view'];
end $$;

-- ------------------------------------------------------------------ 2. permissions for every branch
do $$
declare
  admin uuid := 'a9000000-0000-4000-8000-000000000001';
  r jsonb;
begin
  perform public.phase9_act_as(admin);
  assert not public.app_is_report_export_owner(), 'a System Admin is not automatically designated';
  perform public.phase9_expect('42501', $q$select public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2026-11"}', 'ar', true, gen_random_uuid())$q$);
  perform public.phase9_act_as(null);
  insert into app_private.report_export_owners (organization_id, staff_id)
    select organization_id, user_id from public.staff_accounts where user_id = admin;
  perform public.phase9_act_as(admin);
  r := public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid());
  assert r ->> 'status' = 'pending' and r ->> 'period_label' = '2026-11' and (r ->> 'replayed')::boolean = false, 'the administrator requests Daily Sales';
  r := public.app_report_export_request('sales_comparison', array['bourgogne', 'alquds', 'maarif'], '{"mode":"week","current":"2026-11-17","prior":"2026-11-10"}', 'en', false, gen_random_uuid());
  assert r -> 'branches' = '["alquds", "maarif", "bourgogne"]'::jsonb and r ->> 'period_label' = '2026-11-17 vs 2026-11-10', 'branches in report order';
  r := public.app_report_export_request('inventory', array['maarif'], '{"mode":"day","date":"2026-11-02"}', 'ar', false, gen_random_uuid());
  r := public.app_report_export_request('daily_ledger', array['maarif'], '{"mode":"day","date":"2026-11-02"}', 'ar', true, gen_random_uuid());
  assert (r ->> 'include_drafts')::boolean, 'the administrator may export drafts';
  perform public.phase9_act_as('a9000000-0000-4000-8000-000000000002');
  assert not public.app_is_report_export_owner(), 'a second System Admin is not designated';
  perform public.phase9_expect('42501', $q$select public.app_report_export_request('sales_comparison', array['maarif'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid())$q$);

  -- The manager holds no reports.export; the cashier holds neither reports.export nor comparison.export.
  perform public.phase9_act_as('a9000000-0000-4000-8000-000000000003');
  perform public.phase9_expect('42501', $q$select public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_expect('42501', $q$select public.app_report_export_request('sales_comparison', array['maarif'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_act_as('a9000000-0000-4000-8000-000000000004');
  perform public.phase9_expect('42501', $q$select public.app_report_export_request('daily_statement', array['maarif'], '{"mode":"day","date":"2026-11-02"}', 'ar', true, gen_random_uuid())$q$);

  -- Temporarily designate the test account with comparison.export for Al Quds only.
  perform public.phase9_act_as(null);
  update app_private.report_export_owners set staff_id = 'a9000000-0000-4000-8000-000000000005' where staff_id = admin;
  perform public.phase9_act_as('a9000000-0000-4000-8000-000000000005');
  r := public.app_report_export_request('sales_comparison', array['alquds'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid());
  assert r -> 'branches' = '["alquds"]'::jsonb, 'one permitted branch';
  perform public.phase9_expect('42501', $q$select public.app_report_export_request('sales_comparison', array['alquds', 'bourgogne'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_expect('42501', $q$select public.app_report_export_request('sales_comparison', array['maarif'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid())$q$);

  -- reports.export without daily_close.export_draft: final exports only.
  perform public.phase9_act_as(null);
  update app_private.report_export_owners set staff_id = 'a9000000-0000-4000-8000-000000000006'
    where staff_id = 'a9000000-0000-4000-8000-000000000005';
  perform public.phase9_act_as('a9000000-0000-4000-8000-000000000006');
  r := public.app_report_export_request('daily_statement', array['maarif'], '{"mode":"day","date":"2026-11-02"}', 'ar', false, gen_random_uuid());
  perform public.phase9_expect('42501', $q$select public.app_report_export_request('daily_statement', array['maarif'], '{"mode":"day","date":"2026-11-02"}', 'ar', true, gen_random_uuid())$q$);
  perform public.phase9_expect('42501', $q$select public.app_report_export_request('inventory', array['maarif'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_act_as(null);
  update app_private.report_export_owners set staff_id = admin where staff_id = 'a9000000-0000-4000-8000-000000000006';
end $$;

-- ------------------------------------------------------------------ 3. validation and one export per request
do $$
declare
  admin uuid := 'a9000000-0000-4000-8000-000000000001';
  req uuid := gen_random_uuid();
  a jsonb;
  b jsonb;
begin
  perform public.phase9_act_as(admin);
  perform public.phase9_expect('22023', $q$select public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2099-01"}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_expect('22023', $q$select public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"day","date":"2026-11-02"}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_expect('22023', $q$select public.app_report_export_request('sales_comparison', array['maarif'], '{"mode":"week","current":"2026-11-17","prior":"2026-11-11"}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_expect('22023', $q$select public.app_report_export_request('sales_comparison', array['maarif'], '{"mode":"week","current":"2026-11-10","prior":"2026-11-17"}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_expect('22023', $q$select public.app_report_export_request('inventory', array['maarif'], '{"mode":"month","month":"2026-11"}', 'ar', true, gen_random_uuid())$q$);
  perform public.phase9_expect('22023', $q$select public.app_report_export_request('daily_sales', array['maarif', 'alquds'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_expect('22023', $q$select public.app_report_export_request('daily_sales', array['alquds'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_expect('22023', $q$select public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2026-11","x":1}', 'ar', false, gen_random_uuid())$q$);
  perform public.phase9_expect('22023', $q$select public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2026-11"}', 'fr', false, gen_random_uuid())$q$);
  perform public.phase9_expect('22023', $q$select public.app_report_export_request('payroll', array['maarif'], '{"mode":"month","month":"2026-11"}', 'ar', false, gen_random_uuid())$q$);

  a := public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2026-10"}', 'ar', false, req);
  b := public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2026-10"}', 'ar', false, req);
  assert a ->> 'id' = b ->> 'id' and (b ->> 'replayed')::boolean, 'a resubmitted form is the same export';
  assert (select count(*) from public.report_exports where request_id = req) = 1, 'one row per request';
  perform public.phase9_expect('23505', format($q$select public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2026-09"}', 'ar', false, %L)$q$, req));
  perform public.phase9_act_as(null);
end $$;

-- ------------------------------------------------------------------ 4. claim, store, complete, fail, retry
do $$
declare
  admin uuid := 'a9000000-0000-4000-8000-000000000001';
  e uuid;
  c jsonb;
  path text;
begin
  perform public.phase9_act_as(admin);
  e := (public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2026-08"}', 'en', false, gen_random_uuid()) ->> 'id')::uuid;
  c := public.app_report_export_claim(e);
  assert c ->> 'claim' = 'claimed' and (c ->> 'attempt')::int = 1 and c ->> 'status' = 'running' and c ->> 'snapshot_at' is not null, 'attempt 1 starts';
  path := c ->> 'upload_path';
  assert path = (select organization_id::text from public.report_exports where id = e) || '/' || e || '/attempt-1.xlsx', 'upload path of the attempt';
  assert (public.app_report_export_claim(e) ->> 'claim') = 'busy', 'a second claim while it runs is busy';
  assert app_private.report_export_may_upload(path) and not app_private.report_export_may_upload(replace(path, 'attempt-1', 'attempt-2')),
    'only the running attempt may upload, only to its own path';

  -- Not stored yet: not complete. Then the attempt fails and is retried as attempt 2.
  perform public.phase9_expect('P0002', format('select public.phase9_complete(%L, 1)', e));
  assert (public.app_report_export_fail(e, 1, 'storage_failed') ->> 'status') = 'failed';
  assert (select status = 'failed' and last_error = 'storage_failed' and completed_at is null from public.report_exports where id = e), 'failed, not complete';
  c := public.app_report_export_claim(e);
  assert (c ->> 'attempt')::int = 2 and c ->> 'upload_path' like '%/attempt-2.xlsx', 'the retry is attempt 2';
  -- The abandoned attempt 1 can neither complete nor fail the export any more.
  perform public.phase9_store(replace(c ->> 'upload_path', 'attempt-2', 'attempt-1'), 1000);
  perform public.phase9_expect('40001', format('select public.phase9_complete(%L, 1)', e));
  assert (public.app_report_export_fail(e, 1, 'late') ->> 'status') = 'running', 'a stale failure is ignored';

  perform public.phase9_store(c ->> 'upload_path', 1234);
  perform public.phase9_expect('P0002', format('select public.phase9_complete(%L, 2, 999)', e)); -- the stored size must match
  c := public.phase9_complete(e, 2, 1234);
  assert c ->> 'status' = 'complete' and c ->> 'file_path' like '%/attempt-2.xlsx' and c ->> 'template_version' = 'daily_sales@1.0.0', 'complete after storage';
  perform public.phase9_expect('40001', format('select public.phase9_complete(%L, 2, 1234)', e));
  assert (public.app_report_export_claim(e) ->> 'claim') = 'complete', 'a finished export is never rebuilt';
  assert (select count(*) from public.report_exports where id = e and status = 'complete') = 1, 'exactly one completed file';
  assert (select array_agg(event || ':' || attempt order by id) from public.report_export_events where export_id = e)
     = array['requested:0', 'started:1', 'failed:1', 'started:2', 'completed:2'], 'history of the export';
  assert (select count(*) from public.audit_log where target_type = 'report_export' and target_id = e::text) = 2, 'request and completion audited';

  -- Downloads: recorded; Storage read allowed for the requester only.
  c := public.app_report_export_download(e);
  assert c ->> 'file_path' like '%/attempt-2.xlsx' and app_private.report_export_may_read(c ->> 'file_path'), 'the requester may read the file';
  assert not app_private.report_export_may_read(replace(c ->> 'file_path', 'attempt-2', 'attempt-1')), 'the abandoned attempt is not readable';
  assert (select count(*) from public.report_export_events where export_id = e and event = 'downloaded') = 1;
  perform set_config('phase9.export', e::text, false);
  perform public.phase9_act_as(null);
end $$;

-- ------------------------------------------------------------------ 5. frozen records, other people, revoked permission
do $$
declare
  admin uuid := 'a9000000-0000-4000-8000-000000000001';
  e uuid := current_setting('phase9.export')::uuid;
  path text := (select file_path from public.report_exports where id = current_setting('phase9.export')::uuid);
  s uuid;
begin
  -- Even the table owner cannot change or remove a completed export or its history.
  perform public.phase9_expect('42501', format('update public.report_exports set file_sha256 = repeat(''c'', 64) where id = %L', e));
  perform public.phase9_expect('42501', format('update public.report_exports set status = ''failed'' where id = %L', e));
  perform public.phase9_expect('42501', format('delete from public.report_exports where id = %L', e));
  perform public.phase9_expect('42501', format('delete from public.report_export_events where export_id = %L', e));
  perform public.phase9_expect('42501', 'truncate public.report_export_events');

  -- Another administrator: may review the record (admin.audit.view) but neither download nor retry it.
  perform public.phase9_act_as('a9000000-0000-4000-8000-000000000002');
  assert (select count(*) from public.report_exports where id = e) = 1, 'the record is reviewable by an auditor';
  assert (public.app_report_export(e) ->> 'mine')::boolean = false and (public.app_report_export(e) ->> 'allowed')::boolean = false;
  perform public.phase9_expect('P0002', format('select public.app_report_export_download(%L)', e));
  perform public.phase9_expect('P0002', format('select public.app_report_export_claim(%L)', e));
  assert not app_private.report_export_may_read(path), 'Storage refuses another person';
  assert (select count(*) from storage.objects where bucket_id = 'report-exports' and name = path) = 0, 'the file is invisible to them';
  -- The cashier sees no export at all.
  perform public.phase9_act_as('a9000000-0000-4000-8000-000000000004');
  assert (select count(*) from public.report_exports) = 0 and (select count(*) from public.report_export_events) = 0, 'cashier sees nothing';
  assert public.app_report_exports(50) = '[]'::jsonb;
  perform public.phase9_act_as(null);
  perform public.phase9_act_as(null);

  -- The requester sees the file through Storage's own policy until the permission is removed.
  perform public.phase9_act_as(admin);
  perform set_config('storage.operation', 'storage.object.get_authenticated', true);
  assert (select count(*) from storage.objects where bucket_id = 'report-exports' and name = path) = 1, 'readable by the requester';
  perform set_config('storage.operation', 'storage.object.sign', true);
  assert (select count(*) from storage.objects where bucket_id = 'report-exports' and name = path) = 0, 'not available for signing';
  perform set_config('storage.operation', 'storage.object.get_authenticated', true);
  perform public.phase9_act_as(null);
  delete from app_private.report_export_owners where staff_id = admin;
  perform public.phase9_act_as(admin);
  assert (public.app_report_export_download(e) ->> 'refused')::boolean, 'removing the designation revokes download access';
  assert not app_private.report_export_may_read(path), 'Storage refuses after the designation is removed';
  perform public.phase9_act_as(null);
  insert into app_private.report_export_owners (organization_id, staff_id)
    select organization_id, user_id from public.staff_accounts where user_id = admin;
  delete from public.staff_group_assignments where staff_id = admin and group_key = 'system_admin';
  perform public.phase9_act_as(admin);
  assert (public.app_report_export_download(e) ->> 'refused')::boolean, 'the download is refused after the permission is removed';
  assert not app_private.report_export_may_read(path), 'Storage refuses after the permission is removed';
  assert (select count(*) from storage.objects where bucket_id = 'report-exports' and name = path) = 0, 'the file disappears for them';
  assert (select count(*) from public.report_exports where id = e) = 1, 'the record itself stays (provenance is kept)';
  perform public.phase9_act_as(null);
  assert (select count(*) from public.report_export_events where export_id = e and event = 'refused') = 2, 'both refusals are recorded';
  insert into public.staff_group_assignments(staff_id, branch_id, group_key) values (admin, null, 'system_admin');

  -- An abandoned run (claim older than ten minutes) is taken over by a retry as the next attempt.
  perform public.phase9_act_as(admin);
  s := (public.app_report_export_request('daily_sales', array['maarif'], '{"mode":"month","month":"2026-07"}', 'en', false, gen_random_uuid()) ->> 'id')::uuid;
  perform public.app_report_export_claim(s);
  perform public.phase9_act_as(null);
  update public.report_exports set claimed_at = claimed_at - interval '11 minutes' where id = s;
  perform public.phase9_expect('42501', format('update public.report_exports set family = ''inventory'' where id = %L', s));
  perform public.phase9_act_as(admin);
  assert (public.app_report_export_claim(s) ->> 'attempt')::int = 2, 'a stale run is taken over';
  perform public.phase9_act_as(null);
end $$;

select 'phase9 database checks passed';
rollback;
