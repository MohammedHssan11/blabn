-- Phase 4. A live day is separate from the historical Phase 2 demonstration rows.
-- All live edits are immutable revisions. One transaction owns validation, posting and audit.
revoke insert, update on public.business_days from authenticated, service_role;
revoke insert on public.cash_movements, public.cash_counts from authenticated, service_role;

update public.branches
set business_day_rollover = '02:00'
where code = 'maarif' and operates_in_app and business_day_rollover = '00:00';

-- Fresh local seeds are inserted after the migrations. Use the configured cutoff there too.
alter table public.branches alter column business_day_rollover set default '02:00';
alter function public.business_date_of(timestamptz, text, time) set search_path = '';
comment on column public.branches.business_day_rollover is
  'Local time at which a new branch business day starts. Maarif uses 02:00.';

create table public.operating_accounts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  ledger text not null check (ledger in ('cash', 'custody')),
  code text not null check (code ~ '^[0-9]{1,20}$'),
  label text not null check (length(btrim(label)) between 1 and 120),
  active boolean not null default true,
  unique (branch_id, ledger, code, label)
);
alter table public.operating_accounts enable row level security;
revoke all on public.operating_accounts from public, anon, authenticated, service_role;
grant select on public.operating_accounts to authenticated;
create policy operating_accounts_read on public.operating_accounts for select to authenticated
  using (app_private.has_permission('daily_close.view', branch_id));

create function app_private.seed_operating_accounts(p_branch uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.operating_accounts (branch_id, ledger, code, label)
  select p_branch, v.ledger, v.code, v.label
  from (values
    -- Reviewed SRC-11 Ref_ D5:E41 and D50:E67. Preserve distinct labels that share a code.
    ('custody', '3360201', 'أدوات مكتبية وتصوير ورق'),
    ('custody', '3360502', 'اكراميات'),
    ('custody', '3360803', 'تغيير أنابيب'),
    ('custody', '3320102', 'حافز إجادة'),
    ('custody', '2410101', 'خصم 100%'),
    ('custody', '2410101', 'خصم 50 %'),
    ('custody', '3330202', 'خصم مسموح به 3%-10%'),
    ('custody', '2410101', 'خصم موظفين 10% أو 15%'),
    ('custody', '244010401', 'زيادة كاشير'),
    ('custody', '13701020101', 'سلف عاملين بالفرع'),
    ('custody', '2410101', 'سلف عاملين خارج الفرع'),
    ('custody', '336060102', 'سن سكاكين'),
    ('custody', '3360804', 'شراء أدوات نظافة'),
    ('custody', '32105', 'شراء ألبان: بيض-لبن..إلخ'),
    ('custody', '32103', 'شراء بقالة: تونة-زيتون-..إلخ'),
    ('custody', '31501', 'شراء بيبسي عائلي'),
    ('custody', '31505', 'شراء بيبسي كانز'),
    ('custody', '31508', 'شراء بيبسي نصف لتر'),
    ('custody', '31503', 'شراء بيبسي وان واي'),
    ('custody', '32101', 'شراء خبز: كيزر-فيينا-.. إلخ'),
    ('custody', '32102', 'شراء خضار: طماطم-بصل-.. إلخ'),
    ('custody', '31506', 'شراء عصير'),
    ('custody', '137010401', 'عجز كاشير'),
    ('custody', '316', 'مشتريات لف وحزم'),
    ('custody', '336060102', 'مصروفات صيانة معدات'),
    ('custody', '336060107', 'مصروفات صيانة مقر'),
    ('custody', '13701010102', 'منصرف عهدة دليفري'),
    ('custody', '3360302', 'مواصلات'),
    ('custody', '13701010102', 'وارد عهدة دليفري'),
    ('custody', '3320210', 'وجبات عاملين-بدل وجبات'),
    ('cash', '1330293', 'آجل أسمنت بني سويف'),
    ('cash', '1330226', 'آجل البنك الأهلي سوسيتيه'),
    ('cash', '1330233', 'آجل جمعية الزمالة المصرية'),
    ('cash', '1330282', 'آجل سرفية مصر'),
    ('cash', '1330262', 'آجل شركة جالكسو'),
    ('cash', '1330213', 'آجل شركة فاج'),
    ('cash', '2410101', 'ايداع بالبنك'),
    ('cash', '1350202', 'ايداع بالبنك داخل الفرع-فروع معينة'),
    ('cash', '2410101', 'توريد للإدارة'),
    ('cash', '332010101', 'رواتب الشهر الحالي'),
    ('cash', '244020104', 'رواتب الشهر الماضي'),
    ('cash', '13701010101', 'منصرف عهدة مشتريات'),
    ('cash', '13701010101', 'وارد عهدة مشتريات')
  ) v(ledger, code, label)
  on conflict (branch_id, ledger, code, label) do nothing;
$$;

select app_private.seed_operating_accounts(id) from public.branches where code = 'maarif' and operates_in_app;

create function app_private.seed_maarif_operating_accounts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.code = 'maarif' and new.operates_in_app then
    perform app_private.seed_operating_accounts(new.id);
  end if;
  return null;
end;
$$;

create trigger branches_seed_operating_accounts after insert on public.branches
  for each row execute function app_private.seed_maarif_operating_accounts();

create function app_private.set_operating_account(
  p_branch text, p_id uuid, p_ledger text, p_code text, p_label text, p_active boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
  old_account public.operating_accounts%rowtype;
  saved public.operating_accounts%rowtype;
begin
  select * into b from public.branches
  where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if auth.uid() is null or b.id is null
     or not app_private.has_permission('admin.config.manage') then
    raise exception 'Account configuration permission required' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.operating_accounts (branch_id, ledger, code, label, active)
    values (b.id, p_ledger, btrim(p_code), btrim(p_label), p_active) returning * into saved;
  else
    select * into old_account from public.operating_accounts where branch_id = b.id and id = p_id for update;
    if not found then raise exception 'Account does not exist in this branch' using errcode = '22023'; end if;
    update public.operating_accounts set ledger = p_ledger, code = btrim(p_code), label = btrim(p_label), active = p_active
    where id = p_id returning * into saved;
  end if;
  if old_account is distinct from saved then
    perform app_private.write_audit(b.organization_id, 'operation', 'operating_account.saved',
      'operating_account', saved.id::text, saved.code, b.id,
      jsonb_build_object('before', to_jsonb(old_account), 'after', to_jsonb(saved)));
  end if;
  return saved.id;
end;
$$;

create function public.app_set_operating_account(
  p_branch text, p_id uuid, p_ledger text, p_code text, p_label text, p_active boolean
)
returns uuid language sql set search_path = '' as $$
  select app_private.set_operating_account(p_branch, p_id, p_ledger, p_code, p_label, p_active);
$$;

revoke all on function app_private.set_operating_account(text, uuid, text, text, text, boolean),
  public.app_set_operating_account(text, uuid, text, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function app_private.set_operating_account(text, uuid, text, text, text, boolean),
  public.app_set_operating_account(text, uuid, text, text, text, boolean) to authenticated;

create table public.operating_days (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  business_date date not null,
  first_cash bigint,
  first_custody bigint,
  unique (branch_id, business_date),
  unique (id, branch_id),
  check ((first_cash is null) = (first_custody is null))
);

create table public.operating_day_revisions (
  id bigint generated always as identity primary key,
  day_id uuid not null,
  branch_id uuid not null,
  revision integer not null check (revision > 0),
  previous_revision integer,
  foreign key (day_id, branch_id) references public.operating_days(id, branch_id),
  foreign key (day_id, previous_revision) references public.operating_day_revisions(day_id, revision),
  unique (day_id, revision),
  check (previous_revision is not distinct from nullif(revision - 1, 0)),
  request_id uuid not null,
  unique (branch_id, request_id),
  command text not null,
  request_hash bytea not null,
  change_kind text,
  check ((command = 'propose') = (change_kind is not null)),
  -- Effective business figures remain in force until a correction is approved.
  effective boolean not null,
  state text not null check (state in ('draft', 'awaiting_review', 'closed', 'corrected')),
  closed_at timestamptz,
  posted_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null references public.staff_accounts(user_id),
  actor_name text not null,
  reason text,
  source_revision integer,
  foreign key (day_id, source_revision) references public.operating_day_revisions(day_id, revision),
  data jsonb not null,
  expected_at_count bigint,
  count_recomputed boolean not null,
  cash_change bigint,
  custody_change bigint not null,
  check ((state in ('closed', 'corrected')) = (closed_at is not null))
);

create index operating_day_revisions_effective_idx
  on public.operating_day_revisions (day_id, id desc) where effective;
create index operating_day_revisions_branch_basis_idx on public.operating_day_revisions (branch_id, id desc);
create index operating_day_revisions_actor_idx on public.operating_day_revisions (actor_id);

alter table public.operating_days enable row level security;
alter table public.operating_day_revisions enable row level security;
revoke all on public.operating_days, public.operating_day_revisions from public, anon, authenticated, service_role;
grant select on public.operating_days, public.operating_day_revisions to authenticated;
create policy operating_days_read on public.operating_days for select to authenticated
  using (app_private.has_permission('daily_close.view', branch_id));
create policy operating_day_revisions_read on public.operating_day_revisions for select to authenticated
  using (app_private.has_permission('daily_close.view', branch_id));

create function app_private.refuse_operating_history_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Operating history is append-only' using errcode = '42501';
end;
$$;

create trigger operating_days_no_change before update or delete on public.operating_days
  for each row execute function app_private.refuse_operating_history_change();
create trigger operating_days_no_truncate before truncate on public.operating_days
  for each statement execute function app_private.refuse_operating_history_change();
create trigger operating_day_revisions_no_change before update or delete on public.operating_day_revisions
  for each row execute function app_private.refuse_operating_history_change();
create trigger operating_day_revisions_no_truncate before truncate on public.operating_day_revisions
  for each statement execute function app_private.refuse_operating_history_change();

-- Internal helpers are called by the checked commands, never exposed as Data API functions.
create function app_private.operating_amount(input jsonb, field text, required boolean default false)
returns bigint language plpgsql immutable set search_path = '' as $$
declare
  value text := input ->> field;
begin
  if value is null and not required then return null; end if;
  if value is null or value !~ '^[0-9]{1,14}$' then
    raise exception 'Invalid amount or quantity' using errcode = '22023';
  end if;
  return value::bigint;
end;
$$;

create function app_private.operating_local_instant(input text, zone text)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  local_value timestamp;
  instant timestamptz;
begin
  if input is null or input !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' then
    raise exception 'Invalid local time' using errcode = '22023';
  end if;
  local_value := input::timestamp;
  instant := local_value at time zone zone;
  if (instant at time zone zone) is distinct from local_value then
    raise exception 'Local time does not exist in this timezone' using errcode = '22023';
  end if;
  return instant;
end;
$$;

create function app_private.operating_people(p_branch uuid)
returns table (user_id uuid, name text, role text)
language sql stable security definer set search_path = '' as $$
  select s.user_id, e.full_name, a.group_key
  from public.staff_group_assignments a
  join public.staff_accounts s on s.user_id = a.staff_id
  join public.employees e on e.id = s.employee_id
  where a.branch_id = p_branch and a.group_key in ('cashier', 'manager')
    and s.is_active and e.is_active;
$$;

create function app_private.operating_openings(p_branch uuid, p_date date, p_basis bigint)
returns table (cash bigint, custody bigint)
language sql stable set search_path = '' as $$
  select coalesce(sum(d.first_cash), 0)::bigint + coalesce(sum(v.cash_change) filter (
           where d.business_date < p_date and v.state in ('closed', 'corrected')), 0)::bigint,
         coalesce(sum(d.first_custody), 0)::bigint + coalesce(sum(v.custody_change) filter (
           where d.business_date < p_date and v.state in ('closed', 'corrected')), 0)::bigint
  from public.operating_days d
  cross join lateral (
    select r.state, r.cash_change, r.custody_change
    from public.operating_day_revisions r
    where r.day_id = d.id and r.id <= p_basis and r.effective
    order by r.id desc limit 1
  ) v
  where d.branch_id = p_branch and d.business_date <= p_date;
$$;

create function app_private.operating_summary(p_data jsonb, p_cash bigint, p_custody bigint, p_expected bigint)
returns jsonb language sql stable set search_path = '' as $$
  with entries as (
    select row ->> 'kind' as kind, (row ->> 'amount')::bigint as amount,
           (row ->> 'at')::timestamptz as at
    from jsonb_array_elements(p_data -> 'entries') row
    where not (row ? 'reversedBy')
  ), amounts as (
    select coalesce(sum(amount) filter (where kind = 'cash_expense'), 0)::bigint as expense,
           coalesce(sum(amount) filter (where kind = 'cash_receipt'), 0)::bigint as receipt,
           coalesce(sum(amount) filter (where kind = 'remittance'), 0)::bigint as remittance,
           coalesce(sum(amount) filter (where kind = 'custody_receipt'), 0)::bigint as custody_in,
           coalesce(sum(amount) filter (where kind = 'custody_expense'), 0)::bigint as custody_out,
           coalesce(sum(amount) filter (where kind = 'cash_expense' and at <= (p_data -> 'count' ->> 'at')::timestamptz), 0)::bigint as expense_at_count
    from entries
  )
  select jsonb_build_object(
    'openingCash', p_cash, 'closingCash', p_cash + (p_data ->> 'posCash')::bigint + receipt - expense - remittance,
    'openingCustody', p_custody, 'closingCustody', p_custody + custody_in - custody_out,
    'expenses', expense, 'receipts', receipt, 'remittances', remittance,
    'custodyReceipts', custody_in, 'custodyExpenses', custody_out,
    'expected', p_expected, 'variance', (p_data -> 'count' ->> 'total')::bigint - p_expected,
    'statementTotal', (p_data -> 'count' ->> 'total')::bigint + (p_data ->> 'card')::bigint + expense_at_count,
    'average', round((p_data ->> 'sales')::numeric / nullif((p_data ->> 'orders')::numeric, 0)),
    'cardRatio', round((p_data ->> 'card')::numeric * 10000 / nullif((p_data ->> 'sales')::numeric, 0)),
    'remittanceRatio', round(remittance::numeric * 10000 / nullif((p_data ->> 'sales')::numeric, 0))
  ) from amounts;
$$;

create function app_private.operating_expected(p_data jsonb, p_cash bigint)
returns bigint language sql stable set search_path = '' as $$
  select case when p_data -> 'count' is null or p_data -> 'count' = 'null' or p_data ->> 'sales' is null then null
    else p_cash + (p_data ->> 'posCash')::bigint + coalesce((
      select sum(case when row ->> 'kind' = 'cash_receipt' then (row ->> 'amount')::bigint
                      else -(row ->> 'amount')::bigint end)::bigint
      from jsonb_array_elements(p_data -> 'entries') row
      where row ->> 'kind' in ('cash_receipt', 'cash_expense', 'remittance')
        and not (row ? 'reversedBy')
        and (row ->> 'at')::timestamptz <= (p_data -> 'count' ->> 'at')::timestamptz
    ), 0) end;
$$;
create function app_private.operating_command(
  p_branch text, p_date date, p_command text, p_expected_revision integer, p_request uuid, p_payload jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  b public.branches%rowtype;
  d public.operating_days%rowtype;
  last_row public.operating_day_revisions%rowtype;
  saved public.operating_day_revisions%rowtype;
  current_row public.operating_day_revisions%rowtype;
  caller uuid := auth.uid();
  actor text;
  action text := p_command;
  proposal boolean := p_command = 'propose';
  is_effective boolean := true;
  calc_count boolean := false;
  proposed_expected bigint;
  reason text;
  source_revision integer;
  state text;
  close_time timestamptz;
  actual_time timestamptz;
  local_time text;
  now_at timestamptz;
  today date;
  day_data jsonb;
  entry jsonb;
  line jsonb;
  updated_rows jsonb;
  denomination text;
  quantity bigint;
  count_total bigint;
  kind text;
  value bigint;
  expense_account text;
  bank_reference text;
  person_id uuid;
  person jsonb;
  start_cash bigint;
  start_custody bigint;
  expected bigint;
  metrics jsonb;
  net_sales bigint;
  cash bigint;
  card bigint;
  morning bigint;
  evening bigint;
  orders bigint;
  target text;
  request_hash bytea;
begin
  if caller is null or p_request is null or p_date is null or not isfinite(p_date)
     or p_expected_revision is null or p_expected_revision < 0 or p_command is null
     or jsonb_typeof(p_payload) is distinct from 'object'
     or pg_column_size(p_payload) > 16384 then
    raise exception 'Invalid daily close request' using errcode = '22023';
  end if;

  select * into b from public.branches
  where organization_id = app_private.current_org() and code = p_branch and operates_in_app;
  if not found or not app_private.has_permission('daily_close.view', b.id) then
    raise exception 'Daily close access required' using errcode = '42501';
  end if;

  if p_command in ('close', 'return', 'propose', 'approve', 'reject', 'late_remittance') then
    if not app_private.has_permission('daily_close.close', b.id) then
      raise exception 'Branch close permission required' using errcode = '42501';
    end if;
  elsif p_command = 'count' then
    if not (app_private.has_permission('cash_count.enter', b.id) or app_private.has_permission('daily_close.close', b.id)) then
      raise exception 'Count permission required' using errcode = '42501';
    end if;
  elsif p_command in ('save', 'entry', 'cancel_order', 'reverse_entry', 'reverse_cancellation', 'submit') then
    if not app_private.has_permission('daily_close.draft', b.id) then
      raise exception 'Draft permission required' using errcode = '42501';
    end if;
  else
    raise exception 'Unknown daily close command' using errcode = '22023';
  end if;

  -- Branch serialization also protects the carry-forward chain when different days are edited.
  perform 1 from public.branches where id = b.id for update;
  now_at := clock_timestamp();
  today := public.business_date_of(now_at, b.timezone, b.business_day_rollover);
  if p_date > today or p_date < date '0001-01-01' then
    raise exception 'Business day has not started' using errcode = '22023';
  end if;

  request_hash := sha256(convert_to(p_payload::text, 'UTF8'));
  select * into d from public.operating_days where branch_id = b.id and business_date = p_date;
  select * into saved from public.operating_day_revisions where branch_id = b.id and request_id = p_request;
  if found then
    if saved.day_id is distinct from d.id or saved.actor_id <> caller or saved.command <> p_command
       or saved.request_hash <> request_hash or coalesce(saved.previous_revision, 0) <> p_expected_revision then
      raise exception 'Request identifier already used' using errcode = '23505';
    end if;
    return jsonb_build_object('revision', saved.revision, 'basis', saved.id);
  end if;

  select * into last_row from public.operating_day_revisions where day_id = d.id order by revision desc limit 1;
  if coalesce(last_row.revision, 0) <> p_expected_revision then
    raise exception 'Daily close revision has changed' using errcode = '40001';
  end if;
  select * into current_row from public.operating_day_revisions
  where day_id = d.id and effective order by revision desc limit 1;
  day_data := coalesce(current_row.data, '{"entries":[],"cancellations":[]}'::jsonb);
  state := coalesce(current_row.state, 'draft');
  close_time := current_row.closed_at;
  expected := current_row.expected_at_count;

  if d.id is null then
    if p_command <> 'save' then raise exception 'Save the draft first' using errcode = '22023'; end if;
    if not exists (select 1 from public.operating_days where branch_id = b.id) then
      insert into public.operating_days (branch_id, business_date, first_cash, first_custody)
      values (b.id, p_date, app_private.operating_amount(p_payload, 'openingCash', true),
              app_private.operating_amount(p_payload, 'openingCustody', true)) returning * into d;
    else
      if p_date < (select min(business_date) from public.operating_days where branch_id = b.id)
         or exists (select 1 from public.operating_days x
            join public.operating_day_revisions r on r.day_id = x.id
            where x.branch_id = b.id and x.business_date > p_date and r.command = 'close') then
        raise exception 'Cannot insert a day before an already posted day' using errcode = '22023';
      end if;
      insert into public.operating_days (branch_id, business_date) values (b.id, p_date) returning * into d;
    end if;
  end if;

  if last_row.command = 'propose' and p_command not in ('approve', 'reject') then
    raise exception 'Resolve the pending correction first' using errcode = '22023';
  end if;

  if proposal then
    action := coalesce(p_payload ->> 'change', '');
    reason := btrim(coalesce(p_payload ->> 'reason', ''));
    if state not in ('closed', 'corrected') or length(reason) not between 1 and 500
       or action not in ('save', 'count', 'entry', 'reverse_entry', 'cancel_order', 'reverse_cancellation') then
      raise exception 'A posted day, correction reason and supported change are required' using errcode = '22023';
    end if;
    source_revision := current_row.revision;
    is_effective := false;
  elsif p_command in ('approve', 'reject') then
    if last_row.command is distinct from 'propose' then
      raise exception 'There is no pending correction' using errcode = '22023';
    end if;
    source_revision := last_row.revision;
    reason := last_row.reason;
    if p_command = 'approve' then
      day_data := last_row.data;
      state := 'corrected';
      expected := last_row.expected_at_count;
      calc_count := last_row.count_recomputed;
      proposed_expected := last_row.expected_at_count;
    else
      is_effective := false;
    end if;
  elsif p_command = 'late_remittance' then
    if state not in ('closed', 'corrected') then
      raise exception 'A paid bank remittance requires a posted day' using errcode = '22023';
    end if;
    action := 'entry';
    source_revision := current_row.revision;
  elsif p_command in ('save', 'entry', 'cancel_order', 'reverse_entry', 'reverse_cancellation', 'submit') and state <> 'draft' then
    raise exception 'Return the day to draft to edit it' using errcode = '22023';
  elsif p_command = 'count' and state not in ('draft', 'awaiting_review') then
    raise exception 'A posted count must be corrected' using errcode = '22023';
  end if;

  select e.full_name into actor from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = caller;

  if action = 'save' then
    net_sales := app_private.operating_amount(p_payload, 'sales');
    morning := app_private.operating_amount(p_payload, 'morning');
    evening := app_private.operating_amount(p_payload, 'evening');
    cash := app_private.operating_amount(p_payload, 'posCash');
    card := app_private.operating_amount(p_payload, 'card');
    orders := app_private.operating_amount(p_payload, 'orders');
    if orders > 2147483647
       or (morning + evening is not null and net_sales is not null and morning + evening <> net_sales)
       or (cash + card is not null and net_sales is not null and cash + card <> net_sales)
       or (proposal and (net_sales is null or cash is null or card is null))
       or length(coalesce(p_payload ->> 'notes', '')) > 500
       or coalesce(p_payload ->> 'shift', '') not in ('', 'morning', 'evening', 'both') then
      raise exception 'Invalid sales, payments, orders or notes' using errcode = '22023';
    end if;
    person_id := nullif(p_payload ->> 'cashier', '')::uuid;
    if person_id is not null and person_id is not distinct from (day_data -> 'cashier' ->> 'id')::uuid then
      person := day_data -> 'cashier';
    elsif person_id is not null then
      select jsonb_build_object('id', x.user_id, 'name', x.name, 'role', x.role) into person
      from app_private.operating_people(b.id) x where x.user_id = person_id and x.role = 'cashier';
      if not found then raise exception 'Select a branch cashier' using errcode = '22023'; end if;
    end if;
    if proposal and person is null then
      raise exception 'A posted day needs a cashier' using errcode = '22023';
    end if;
    calc_count := (day_data ->> 'posCash')::bigint is distinct from cash
      or ((day_data ->> 'sales') is null) <> (net_sales is null);
    day_data := day_data || jsonb_build_object('sales', net_sales, 'morning', morning, 'evening', evening,
      'posCash', cash, 'card', card, 'orders', orders, 'cashier', person, 'shift', p_payload ->> 'shift',
      'notes', btrim(coalesce(p_payload ->> 'notes', '')));

  elsif action = 'count' then
    local_time := p_payload ->> 'local';
    actual_time := app_private.operating_local_instant(local_time, b.timezone);
    if actual_time > now_at or (actual_time at time zone b.timezone)::date not between p_date and p_date + 1
       or (actual_time at time zone b.timezone) < p_date + b.business_day_rollover
       or jsonb_typeof(p_payload -> 'quantities') is distinct from 'object'
       or p_payload -> 'quantities' = '{}'::jsonb then
      raise exception 'Invalid count time or denominations' using errcode = '22023';
    end if;
    if proposal and actual_time > close_time then
      raise exception 'Count time cannot follow the close' using errcode = '22023';
    end if;
    person_id := (p_payload ->> 'counter')::uuid;
    if person_id is not null and person_id = (day_data -> 'count' -> 'counter' ->> 'id')::uuid then
      person := day_data -> 'count' -> 'counter';
    else
      select jsonb_build_object('id', x.user_id, 'name', x.name, 'role', x.role) into person
      from app_private.operating_people(b.id) x where x.user_id = person_id and x.role = 'manager';
      if not found then raise exception 'Select the manager who counted' using errcode = '22023'; end if;
    end if;
    count_total := 0;
    for denomination in select jsonb_object_keys(p_payload -> 'quantities') loop
      if denomination not in ('1','5','10','20','50','100','200','500','1000','2000','5000','10000','20000') then
        raise exception 'Unknown MAD denomination' using errcode = '22023';
      end if;
      quantity := app_private.operating_amount(p_payload -> 'quantities', denomination, true);
      if quantity > 100000000 then raise exception 'Invalid denomination quantity' using errcode = '22023'; end if;
      count_total := count_total + denomination::bigint * quantity;
    end loop;
    day_data := jsonb_set(day_data, '{count}', jsonb_build_object('local', local_time,
      'at', actual_time, 'counter', person, 'recorder', caller, 'recorderName', actor,
      'quantities', p_payload -> 'quantities', 'total', count_total));
    calc_count := true;

  elsif action = 'entry' then
    kind := case when p_command = 'late_remittance' then 'remittance' else p_payload ->> 'kind' end;
    value := app_private.operating_amount(p_payload, 'amount', true);
    local_time := p_payload ->> 'local';
    actual_time := app_private.operating_local_instant(local_time, b.timezone);
    if nullif(p_payload ->> 'account', '') is not null then
      select a.code || ' · ' || a.label into expense_account from public.operating_accounts a
      where a.branch_id = b.id and a.active and a.id = (p_payload ->> 'account')::uuid
        and a.ledger = case when kind in ('custody_receipt', 'custody_expense') then 'custody' else 'cash' end;
      if not found then raise exception 'Select an active account for this ledger' using errcode = '22023'; end if;
    end if;
    bank_reference := nullif(btrim(coalesce(p_payload ->> 'reference', '')), '');
    if kind is null or kind not in ('cash_receipt', 'cash_expense', 'remittance', 'custody_receipt', 'custody_expense')
       or value <= 0 or actual_time > now_at or (actual_time at time zone b.timezone)::date not between p_date and p_date + 1
       or (actual_time at time zone b.timezone) < p_date + b.business_day_rollover
       or length(coalesce(p_payload ->> 'note', '')) > 500 or length(expense_account) > 145
       or length(bank_reference) > 100 or (kind = 'remittance' and bank_reference is null) then
      raise exception 'Invalid ledger entry' using errcode = '22023';
    end if;
    if p_command = 'late_remittance' and actual_time <= (day_data -> 'count' ->> 'at')::timestamptz then
      raise exception 'Use a correction for a remittance through the count time' using errcode = '22023';
    end if;
    if jsonb_array_length(day_data -> 'entries') >= 250 then
      raise exception 'Too many entries on the business day' using errcode = '22023';
    end if;
    if kind = 'remittance' and exists (select 1 from jsonb_array_elements(day_data -> 'entries') x
         where x ->> 'kind' = 'remittance' and lower(x ->> 'reference') = lower(bank_reference) and not (x ? 'reversedBy')) then
      raise exception 'Bank reference already recorded' using errcode = '23505';
    end if;
    entry := jsonb_build_object('id', p_request, 'kind', kind, 'amount', value, 'local', local_time,
      'at', actual_time, 'account', expense_account, 'reference', bank_reference,
      'note', btrim(coalesce(p_payload ->> 'note', '')));
    day_data := jsonb_set(day_data, '{entries}', (day_data -> 'entries') || entry);
    calc_count := kind in ('cash_receipt', 'cash_expense', 'remittance')
      and actual_time <= (day_data -> 'count' ->> 'at')::timestamptz;

  elsif action = 'cancel_order' then
    actual_time := app_private.operating_local_instant(p_payload ->> 'local', b.timezone);
    if public.business_date_of(app_private.operating_local_instant(p_payload ->> 'originalLocal', b.timezone),
         b.timezone, b.business_day_rollover) <> p_date
       or actual_time < app_private.operating_local_instant(p_payload ->> 'originalLocal', b.timezone)
       or actual_time > now_at or (actual_time at time zone b.timezone)::date > p_date + 1
       or length(btrim(coalesce(p_payload ->> 'original', ''))) not between 1 and 80
       or length(coalesce(p_payload ->> 'replacement', '')) > 80
       or length(btrim(coalesce(p_payload ->> 'note', ''))) not between 1 and 500
       or jsonb_array_length(day_data -> 'cancellations') >= 250 then
      raise exception 'Invalid cancellation details' using errcode = '22023';
    end if;
    value := app_private.operating_amount(p_payload, 'replacementAmount');
    if (nullif(btrim(coalesce(p_payload ->> 'replacement', '')), '') is null) <> (value is null) then
      raise exception 'Record both the replacement order and its value' using errcode = '22023';
    end if;
    entry := jsonb_build_object('id', p_request, 'original', btrim(p_payload ->> 'original'),
      'originalAmount', app_private.operating_amount(p_payload, 'originalAmount', true),
      'originalLocal', p_payload ->> 'originalLocal',
      'replacement', nullif(btrim(coalesce(p_payload ->> 'replacement', '')), ''),
      'replacementAmount', value, 'local', p_payload ->> 'local', 'at', actual_time,
      'note', btrim(p_payload ->> 'note'));
    day_data := jsonb_set(day_data, '{cancellations}', (day_data -> 'cancellations') || entry);

  elsif action in ('reverse_entry', 'reverse_cancellation') then
    kind := case when action = 'reverse_entry' then 'entries' else 'cancellations' end;
    target := p_payload ->> 'target';
    updated_rows := '[]'::jsonb;
    for line in select x.item from jsonb_array_elements(day_data -> kind) x(item) loop
      if line ->> 'id' = target and not (line ? 'reversedBy') then
        entry := line;
        line := line || jsonb_build_object('reversedBy', p_request);
      end if;
      updated_rows := updated_rows || line;
    end loop;
    if entry is null then raise exception 'Entry is missing or already reversed' using errcode = '22023'; end if;
    calc_count := kind = 'entries' and entry ->> 'kind' in ('cash_receipt', 'cash_expense', 'remittance')
      and (entry ->> 'at')::timestamptz <= (day_data -> 'count' ->> 'at')::timestamptz;
    day_data := jsonb_set(day_data, array[kind], updated_rows);

  elsif action = 'submit' then
    state := 'awaiting_review';
  elsif action in ('return', 'close') then
    if state <> 'awaiting_review' then raise exception 'Day is not awaiting review' using errcode = '22023'; end if;
    if action = 'return' then
      state := 'draft';
    else
      if day_data ->> 'sales' is null or day_data ->> 'posCash' is null or day_data ->> 'card' is null
         or day_data ->> 'cashier' is null or day_data ->> 'count' is null then
        raise exception 'Sales, payments, cashier and a physical count are required' using errcode = '22023';
      end if;
      if exists (select 1 from public.operating_days x
        cross join lateral (select r.state from public.operating_day_revisions r
          where r.day_id = x.id and r.effective order by r.id desc limit 1) previous
        where x.branch_id = b.id and x.business_date < p_date and previous.state not in ('closed', 'corrected')) then
        raise exception 'Close the earlier day first' using errcode = '22023';
      end if;
      state := 'closed';
      close_time := now_at;
      calc_count := true;
    end if;
  end if;

  if is_effective and action in ('entry', 'approve') and exists (
    select 1 from public.operating_day_revisions r
    cross join lateral jsonb_array_elements(r.data -> 'entries') existing
    join lateral jsonb_array_elements(day_data -> 'entries') incoming
      on lower(existing ->> 'reference') = lower(incoming ->> 'reference')
    where r.branch_id = b.id and r.day_id <> d.id and r.effective
      and r.id = (select max(v.id) from public.operating_day_revisions v where v.day_id = r.day_id and v.effective)
      and existing ->> 'kind' = 'remittance' and not (existing ? 'reversedBy')
      and incoming ->> 'kind' = 'remittance' and not (incoming ? 'reversedBy')
  ) then
    raise exception 'Bank reference is already recorded on another day' using errcode = '23505';
  end if;

  select o.cash, o.custody into start_cash, start_custody
    from app_private.operating_openings(b.id, p_date, 9223372036854775807) o;
  if d.first_cash is not null then
    start_cash := d.first_cash;
    start_custody := d.first_custody;
  end if;
  if calc_count then
    expected := app_private.operating_expected(day_data, start_cash);
    if action = 'approve' and expected is distinct from proposed_expected then
      raise exception 'The opening balance changed since review; reject and propose the correction again'
        using errcode = '40001';
    end if;
  end if;
  metrics := app_private.operating_summary(day_data, start_cash, start_custody, expected);
  if exists (select 1 from jsonb_each_text(metrics) x where abs(x.value::numeric) > 9007199254740991) then
    raise exception 'Daily totals exceed the supported range' using errcode = '22003';
  end if;

  select e.full_name into actor from public.staff_accounts s join public.employees e on e.id = s.employee_id
  where s.user_id = caller;
  insert into public.operating_day_revisions (
    day_id, branch_id, revision, previous_revision, request_id, command, request_hash, change_kind, effective,
    state, closed_at, actor_id, actor_name, reason, source_revision, data, expected_at_count, count_recomputed, cash_change, custody_change
  ) values (d.id, b.id, p_expected_revision + 1, nullif(p_expected_revision, 0), p_request, p_command, request_hash, case when proposal then action end, is_effective,
    state, close_time, caller, actor, reason, source_revision, day_data, expected, coalesce(calc_count, false),
    (metrics ->> 'closingCash')::bigint - start_cash, (metrics ->> 'closingCustody')::bigint - start_custody)
  returning * into saved;
  perform app_private.write_audit(b.organization_id, 'operation', 'daily_close.' || p_command,
     'operating_day', d.id::text, p_date::text, b.id,
     jsonb_build_object('revision', saved.revision, 'prior_revision', saved.previous_revision,
                        'source_revision', source_revision, 'state', state));
  return jsonb_build_object('revision', saved.revision, 'basis', saved.id);
end;
$$;

create function public.app_operating_command(
  p_branch text, p_date date, p_command text, p_expected_revision integer, p_request uuid, p_payload jsonb
)
returns jsonb language sql volatile set search_path = '' as $$
  select app_private.operating_command(p_branch, p_date, p_command, p_expected_revision, p_request, p_payload);
$$;

revoke all on function app_private.operating_command(text, date, text, integer, uuid, jsonb),
  public.app_operating_command(text, date, text, integer, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function app_private.operating_command(text, date, text, integer, uuid, jsonb),
  public.app_operating_command(text, date, text, integer, uuid, jsonb) to authenticated;
-- Report reads run as the caller. The policies on both tables enforce live branch access.
-- A report basis is the last branch revision included in the export, including its carry-forward.
create function public.app_operating_report(p_branch text, p_date date, p_month date, p_basis bigint default null)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  b public.branches%rowtype;
  basis bigint;
  last_row public.operating_day_revisions%rowtype;
  effective_row public.operating_day_revisions%rowtype;
  current_opening record;
  rows jsonb;
  history jsonb;
  result jsonb;
begin
  select * into b from public.branches where code = p_branch and operates_in_app;
  if not found or not app_private.has_permission('daily_close.view', b.id) then
    raise exception 'Daily close view permission required' using errcode = '42501';
  end if;
  if p_basis is not null and not exists (
    select 1 from public.operating_day_revisions where branch_id = b.id and id = p_basis) then
    raise exception 'Report revision not found' using errcode = 'P0002';
  end if;
  select coalesce(p_basis, max(id), 0) into basis from public.operating_day_revisions where branch_id = b.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', d.business_date, 'state', v.state, 'sales', v.data -> 'sales', 'orders', v.data -> 'orders',
    'card', v.data -> 'card', 'summary', app_private.operating_summary(v.data, opening.cash, opening.custody, v.expected_at_count)
  ) order by d.business_date), '[]'::jsonb) into rows
  from public.operating_days d
  cross join lateral (
    select * from public.operating_day_revisions r where r.day_id = d.id
      and r.id <= basis and r.effective order by r.id desc limit 1
  ) v
  cross join lateral app_private.operating_openings(b.id, d.business_date, basis) opening
  where d.branch_id = b.id and d.business_date >= p_month and d.business_date < p_month + interval '1 month';

  select r.* into last_row from public.operating_days d join public.operating_day_revisions r on r.day_id = d.id
  where d.branch_id = b.id and d.business_date = p_date and r.id <= basis order by r.id desc limit 1;

  if last_row.id is not null then
    select * into effective_row from public.operating_day_revisions
      where day_id = last_row.day_id and id <= basis and effective order by id desc limit 1;
    select * into current_opening from app_private.operating_openings(b.id, p_date, basis);
    select coalesce(jsonb_agg(jsonb_build_object('basis', r.id, 'revision', r.revision,
       'actor', r.actor_name, 'command', r.command, 'reason', r.reason, 'sourceRevision', r.source_revision,
       'local', to_char(r.posted_at at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI')) order by r.id desc), '[]'::jsonb)
    into history from public.operating_day_revisions r where r.day_id = last_row.day_id and r.id <= basis;
    result := jsonb_build_object('revision', last_row.revision, 'state', effective_row.state,
      'closedLocal', to_char(effective_row.closed_at at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI'),
      'closedAt', effective_row.closed_at, 'data', effective_row.data, 'history', history,
      'summary', app_private.operating_summary(effective_row.data, current_opening.cash, current_opening.custody, effective_row.expected_at_count),
      'proposal', case when last_row.command = 'propose' then jsonb_build_object(
        'change', last_row.change_kind, 'reason', last_row.reason, 'data', last_row.data,
        'summary', app_private.operating_summary(last_row.data, current_opening.cash, current_opening.custody, last_row.expected_at_count)
      ) end);
  end if;
  return jsonb_build_object('basis', basis, 'days', rows, 'day', result,
    'hasDays', exists (select 1 from public.operating_day_revisions where branch_id = b.id and id <= basis),
    'branch', jsonb_build_object('nameEn', b.name_en, 'nameAr', b.name_ar, 'timezone', b.timezone,
      'cutoff', to_char(b.business_day_rollover, 'HH24:MI'),
      'today', public.business_date_of(now(), b.timezone, b.business_day_rollover),
      'local', to_char(now() at time zone b.timezone, 'YYYY-MM-DD"T"HH24:MI')));
end;
$$;

create function app_private.operating_directory(p_branch text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  branch_id uuid;
begin
  select b.id into branch_id from public.branches b
  where b.code = p_branch and b.organization_id = app_private.current_org() and b.operates_in_app;
  if branch_id is null or not app_private.has_permission('daily_close.view', branch_id) then
    raise exception 'Daily close view permission required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.user_id, 'name', p.name, 'role', p.role) order by p.name)
    from app_private.operating_people(branch_id) p), '[]'::jsonb);
end;
$$;

create function public.app_operating_directory(p_branch text)
returns jsonb language sql stable set search_path = '' as $$
  select app_private.operating_directory(p_branch);
$$;

revoke all on function public.app_operating_report(text, date, date, bigint), app_private.operating_directory(text),
  public.app_operating_directory(text), app_private.operating_openings(uuid, date, bigint),
  app_private.operating_summary(jsonb, bigint, bigint, bigint), public.business_date_of(timestamptz, text, time)
from public, anon, authenticated, service_role;
grant execute on function public.app_operating_report(text, date, date, bigint), app_private.operating_directory(text),
  public.app_operating_directory(text), app_private.operating_openings(uuid, date, bigint),
  app_private.operating_summary(jsonb, bigint, bigint, bigint), public.business_date_of(timestamptz, text, time)
to authenticated;
