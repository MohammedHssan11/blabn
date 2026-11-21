-- Staff sign-in email is changed through the audited administrator workflow.
-- Supabase Auth stages a self-service change in email_change, then updates email
-- and clears email_change together at confirmation. Admin updates set email
-- directly and clear pending Auth tokens separately.
create function app_private.require_managed_staff_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.staff_accounts s where s.user_id = new.id) then
    if (
      nullif(new.email_change, '') is not null
      and (
        new.email_change is distinct from old.email_change
        or new.email_change_sent_at is distinct from old.email_change_sent_at
      )
    ) or (
      nullif(old.email_change, '') is not null
      and new.email is distinct from old.email
      and lower(new.email) = lower(old.email_change)
      and new.email_change is distinct from old.email_change
    ) then
      raise exception 'staff_email_change_requires_admin' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger staff_email_change_requires_admin
before update of email, email_change, email_change_sent_at on auth.users
for each row execute function app_private.require_managed_staff_email();

-- An administrator must first change the real sign-in email through Auth.
-- Writing a different address only to the staff directory would break recovery.
create function app_private.require_staff_email_matches_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users u where u.id = new.user_id and lower(u.email) = new.email) then
    raise exception 'staff_email_must_match_auth' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger staff_email_matches_auth
before update of email on public.staff_accounts
for each row
when (old.email is distinct from new.email)
execute function app_private.require_staff_email_matches_auth();

-- Reconcile older staff rows whose confirmed address was changed through Auth.
-- Keep the original and corrected addresses in the append-only audit history.
with drift as (
  select s.user_id, s.organization_id, s.email as old_email, lower(u.email) as auth_email, e.full_name
  from public.staff_accounts s
  join auth.users u on u.id = s.user_id
  join public.employees e on e.id = s.employee_id
  where s.email is distinct from lower(u.email) and nullif(u.email, '') is not null
), corrected as (
  update public.staff_accounts s
  set email = d.auth_email
  from drift d
  where s.user_id = d.user_id
  returning d.*
)
insert into public.audit_log (organization_id, actor_name, category, action, target_type, target_id, target_label, changes)
select organization_id, 'system', 'administration', 'staff.email_reconciled', 'staff_account',
  user_id::text, full_name,
  jsonb_build_object('before', jsonb_build_object('email', old_email), 'after', jsonb_build_object('email', auth_email))
from corrected;

revoke all on function app_private.require_managed_staff_email() from public, anon, authenticated;
revoke all on function app_private.require_staff_email_matches_auth() from public, anon, authenticated;
