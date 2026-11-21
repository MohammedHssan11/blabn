-- Phase 3 (1 of 4): employee identities, staff accounts, branch memberships and permission groups.
--
-- Design rules
--   * An EMPLOYEE is a person known to the organization. A STAFF ACCOUNT links one employee to one
--     Supabase Auth user, so a person can exist without a sign-in (the kiosk later uses employees).
--   * Access is granted by assigning PERMISSION GROUPS to a staff account. A branch group is
--     assigned per branch and needs a branch membership; an organization group (System Admin) is
--     assigned once and covers every branch of the organization.
--   * A PERMISSION says which kind of branch it works on: 'operational' (Maarif, where the day is
--     closed in this application), 'comparison' (Al Quds and Bourgogne, reporting-only) or 'any'.
--     The check is made from the branch record, so a cashier role can never operate a
--     comparison-only branch even if it is assigned there.
--   * Nothing is cached in a token: every decision reads these tables, so removing a group or
--     disabling an account takes effect on the very next request, even for a signed-in session.
--   * No API role may write these tables. Changes go through the administrator commands in
--     migration 7, which authorize the caller and write the audit history in the same transaction.

create schema if not exists app_private;
comment on schema app_private is
  'Authorization helpers used by policies and commands. Not exposed through the Data API (config.toml exposes only public).';

-- ------------------------------------------------------------------ identities

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  full_name text not null check (length(btrim(full_name)) > 0),
  -- Number typed at the attendance kiosk (Phase 13). Optional; unique inside the organization.
  employee_number text check (employee_number is null or length(btrim(employee_number)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, employee_number)
);

create trigger employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

create table public.staff_accounts (
  user_id uuid primary key references auth.users (id) on delete restrict,
  employee_id uuid not null unique,
  organization_id uuid not null references public.organizations (id),
  -- Copy of the sign-in email for lists and audit. The password lives only in Supabase Auth.
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  is_active boolean not null default true,
  -- True after an administrator creates the account or resets the password with a temporary one.
  must_change_password boolean not null default false,
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (employee_id, organization_id) references public.employees (id, organization_id),
  constraint disabled_account_has_time check (is_active or disabled_at is not null),
  constraint active_account_has_no_disable_time check (not is_active or disabled_at is null)
);

create unique index staff_accounts_org_email_key on public.staff_accounts (organization_id, email);

create trigger staff_accounts_updated_at
  before update on public.staff_accounts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ catalog

create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  description text not null,
  -- 'organization': checked without a branch (administration). 'branch': checked for one branch.
  scope text not null check (scope in ('organization', 'branch')),
  -- Which branches the permission works on. Organization permissions use 'any'.
  branch_kind text not null check (branch_kind in ('operational', 'comparison', 'any')),
  constraint organization_permission_has_no_branch_kind check (scope = 'branch' or branch_kind = 'any')
);

create table public.permission_groups (
  key text primary key check (key ~ '^[a-z_]+$'),
  description text not null,
  -- 'organization' groups are assigned once for the whole organization (System Admin);
  -- 'branch' groups are assigned for one branch the person belongs to.
  scope text not null check (scope in ('organization', 'branch'))
);

create table public.group_permissions (
  group_key text not null references public.permission_groups (key),
  permission_key text not null references public.permissions (key),
  primary key (group_key, permission_key)
);

-- ------------------------------------------------------------------ membership and assignments

create table public.branch_memberships (
  staff_id uuid not null references public.staff_accounts (user_id),
  branch_id uuid not null references public.branches (id),
  created_at timestamptz not null default now(),
  primary key (staff_id, branch_id)
);

create table public.staff_group_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff_accounts (user_id),
  group_key text not null references public.permission_groups (key),
  -- NULL for an organization group. For a branch group the person must be a member of the branch
  -- (the composite key below is not checked while branch_id is NULL).
  branch_id uuid,
  created_at timestamptz not null default now(),
  foreign key (staff_id, branch_id) references public.branch_memberships (staff_id, branch_id),
  unique nulls not distinct (staff_id, group_key, branch_id)
);

create index staff_group_assignments_staff_idx on public.staff_group_assignments (staff_id);

create function app_private.check_group_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g_scope text;
  s_org uuid;
  b_org uuid;
begin
  select scope into g_scope from public.permission_groups where key = new.group_key;
  select organization_id into s_org from public.staff_accounts where user_id = new.staff_id;
  if g_scope = 'organization' and new.branch_id is not null then
    raise exception 'group % is an organization group and cannot be assigned to a branch', new.group_key
      using errcode = '23514';
  end if;
  if g_scope = 'branch' and new.branch_id is null then
    raise exception 'group % must be assigned for a branch', new.group_key using errcode = '23514';
  end if;
  if new.branch_id is not null then
    select organization_id into b_org from public.branches where id = new.branch_id;
    if b_org is distinct from s_org then
      raise exception 'branch belongs to another organization' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger staff_group_assignments_check
  before insert or update on public.staff_group_assignments
  for each row execute function app_private.check_group_assignment();

create function app_private.check_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  s_org uuid;
  b_org uuid;
begin
  select organization_id into s_org from public.staff_accounts where user_id = new.staff_id;
  select organization_id into b_org from public.branches where id = new.branch_id;
  if b_org is distinct from s_org then
    raise exception 'branch belongs to another organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger branch_memberships_check
  before insert or update on public.branch_memberships
  for each row execute function app_private.check_membership();

-- ------------------------------------------------------------------ catalog data
-- Reference data, not test data: production needs the same rows. Keys are mirrored in
-- src/modules/access/catalog.ts and a test fails if the two drift apart.

insert into public.permissions (key, description, scope, branch_kind) values
  ('admin.users.manage',          'Create, change, activate and disable staff accounts and assign branches and permission groups', 'organization', 'any'),
  ('admin.audit.view',            'Read the audit history', 'organization', 'any'),
  ('admin.config.manage',         'Change branch and organization configuration (reserved for later phases)', 'organization', 'any'),
  ('recipes.manage',              'Create and approve recipes (Phase 5)', 'organization', 'any'),
  ('daily_close.view',            'View daily-close figures and cash counts of a branch', 'branch', 'operational'),
  ('daily_close.draft',           'Enter and change an open daily-close draft: sales, payments, expenses, remittances', 'branch', 'operational'),
  ('daily_close.close',           'Close a business day and change a closed day', 'branch', 'operational'),
  ('daily_close.export_draft',    'Download a daily-close draft', 'branch', 'operational'),
  ('cash_count.enter',            'Record a cash count', 'branch', 'operational'),
  ('inventory.view',              'View stock, movements and counts', 'branch', 'operational'),
  ('inventory.receive',           'Record stock receipts', 'branch', 'operational'),
  ('inventory.count',             'Record physical stock counts', 'branch', 'operational'),
  ('inventory.waste',             'Record waste', 'branch', 'operational'),
  ('inventory.hospitality',       'Record hospitality', 'branch', 'operational'),
  ('inventory.adjust',            'Record an inventory adjustment', 'branch', 'operational'),
  ('inventory.adjust_approve',    'Approve an inventory adjustment', 'branch', 'operational'),
  ('purchase_order.propose',      'Propose a purchase order', 'branch', 'operational'),
  ('purchase_order.approve',      'Approve a purchase order', 'branch', 'operational'),
  ('reports.view',                'View reports of an operating branch', 'branch', 'operational'),
  ('reports.export',              'Download reports of an operating branch', 'branch', 'operational'),
  ('comparison.enter',            'Enter reporting-only comparison figures for a comparison branch', 'branch', 'comparison'),
  ('comparison.view',             'View comparison figures of a branch', 'branch', 'any'),
  ('comparison.export',           'Download comparison figures of a branch', 'branch', 'any'),
  ('attendance.event.create',     'Create attendance events for the branch (kiosk, Phase 13)', 'branch', 'operational');

insert into public.permission_groups (key, description, scope) values
  ('system_admin',        'System Admin: users, configuration, recipes, approvals, reports and audit review (Abdo)', 'organization'),
  ('cashier',             'Cashier: daily-close drafts, sales, payments, expenses, cash counts and permitted draft exports', 'branch'),
  ('storekeeper',         'Storekeeper: receipts, stock counts, waste, hospitality and purchase-order proposals', 'branch'),
  ('manager',             'Manager: business-day closing and adjustment approval, when Abdo grants it', 'branch'),
  ('comparison_editor',   'Comparison Editor: enters assigned branch-comparison figures; cannot view or export them', 'branch'),
  ('attendance_kiosk',    'Attendance Kiosk (future): creates attendance events for its own branch only', 'branch');

insert into public.group_permissions (group_key, permission_key)
select 'system_admin', key from public.permissions;

insert into public.group_permissions (group_key, permission_key) values
  ('cashier', 'daily_close.view'),
  ('cashier', 'daily_close.draft'),
  ('cashier', 'cash_count.enter'),
  ('cashier', 'daily_close.export_draft'),
  ('storekeeper', 'inventory.view'),
  ('storekeeper', 'inventory.receive'),
  ('storekeeper', 'inventory.count'),
  ('storekeeper', 'inventory.waste'),
  ('storekeeper', 'inventory.hospitality'),
  ('storekeeper', 'inventory.adjust'),
  ('storekeeper', 'purchase_order.propose'),
  ('manager', 'daily_close.view'),
  ('manager', 'daily_close.close'),
  ('manager', 'inventory.view'),
  ('manager', 'inventory.adjust_approve'),
  ('manager', 'comparison.view'),
  ('comparison_editor', 'comparison.enter'),
  ('attendance_kiosk', 'attendance.event.create');

-- Maarif is the operating branch; Al Quds and Bourgogne are comparison-only. This keeps
-- databases that already hold those records consistent (a fresh database has no rows yet; the
-- seed and the production setup create them with the same flags).
update public.branches
set operates_in_app = (code = 'maarif')
where code in ('maarif', 'alquds', 'bourgogne');

-- ------------------------------------------------------------------ authorization functions
-- All of them read the live tables on every call. They run with the owner's rights so a policy
-- can consult the access tables without granting the caller access to them.

create function app_private.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id
  from public.staff_accounts s
  join public.employees e on e.id = s.employee_id
  where s.user_id = auth.uid() and s.is_active and e.is_active;
$$;

create function app_private.current_org()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.organization_id
  from public.staff_accounts s
  join public.employees e on e.id = s.employee_id
  where s.user_id = auth.uid() and s.is_active and e.is_active;
$$;

-- Every (permission, branch) pair the signed-in, active person holds right now.
-- branch_id is NULL for organization permissions.
create function app_private.effective_permissions()
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
    and (
         (p.scope = 'organization' and a.branch_id is null)
      or (p.scope = 'branch' and b.id is not null)
    );
$$;

-- p_branch is NULL for organization permissions.
create function app_private.has_permission(p_permission text, p_branch uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.effective_permissions() e
    where e.permission_key = p_permission
      and e.branch_id is not distinct from p_branch
  );
$$;

-- A branch is visible to a person who belongs to it or who holds an organization group.
create function app_private.can_see_branch(p_branch uuid)
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
    where s.user_id = auth.uid() and s.is_active
      and (
        exists (select 1 from public.branch_memberships m where m.staff_id = s.user_id and m.branch_id = b.id)
        or exists (select 1 from public.staff_group_assignments a where a.staff_id = s.user_id and a.branch_id is null)
      )
  );
$$;

create function app_private.branch_of_day(p_day uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.branch_id from public.business_days d where d.id = p_day;
$$;

create function app_private.day_is_open(p_day uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select d.status = 'open' from public.business_days d where d.id = p_day), false);
$$;
