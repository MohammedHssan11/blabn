-- Phase 2 foundation: organization, branches and shared helpers.
--
-- Conventions used by every later migration:
--   * Money is numeric(14,2) in MAD. NULL means "blank / not entered"; 0 is a recorded zero.
--   * A business date is a plain `date`. Event times are `timestamptz`. They are stored in
--     separate columns and never derived from each other when saving.
--   * Row-level security is ON for every table. No policies exist yet: until Phase 3 adds
--     accounts and permissions, only the server-side service role can read or write.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Business date of an instant for a branch: the local date in the branch timezone, moved back one
-- day when the local time is before the branch's rollover time. Mirrors businessDateOf() in
-- src/lib/dates.ts; both are covered by tests.
create or replace function public.business_date_of(instant timestamptz, tz text, rollover time)
returns date
language sql
stable
as $$
  select (((instant at time zone tz) - (rollover - time '00:00')))::date;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name_en text not null check (length(btrim(name_en)) > 0),
  name_ar text not null check (length(btrim(name_ar)) > 0),
  -- Branch timezone and the local time at which a new business day starts.
  timezone text not null default 'Africa/Casablanca',
  business_day_rollover time not null default '00:00',
  -- True for a branch that closes its days in this application (Maarif).
  -- Other branches only have reporting-only comparison figures.
  operates_in_app boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

create or replace function public.assert_valid_timezone()
returns trigger
language plpgsql
as $$
begin
  -- Raises "time zone ... not recognized" for an unknown IANA name.
  perform now() at time zone new.timezone;
  return new;
end;
$$;

create trigger branches_valid_timezone
  before insert or update of timezone on public.branches
  for each row execute function public.assert_valid_timezone();

create trigger branches_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

comment on column public.branches.business_day_rollover is
  'Local time at which a branch business day starts. 00:00 until Phase 4 confirms the real trading hours.';

alter table public.organizations enable row level security;
alter table public.branches enable row level security;

-- Deny by default; Phase 3 adds explicit policies. The service role bypasses RLS.
revoke all on table public.organizations, public.branches from anon, authenticated;
