-- Support-only admin (not platform admin) + reach-out audit on enquiries.
-- Staging first (scvojtvgnkmbupvyslmb). Production only on explicit release.

create table if not exists public.support_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now()
);

comment on table public.support_admins is
  'Users who can admin Support (see all tickets, assign, tags) without platform admin.';

create table if not exists public.support_admin_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null check (action in ('granted', 'revoked')),
  actor_id uuid,
  created_at timestamptz not null default now()
);

alter table public.support_admins enable row level security;
alter table public.support_admin_audit enable row level security;

drop policy if exists "support admins read authenticated" on public.support_admins;
create policy "support admins read authenticated"
on public.support_admins
for select
to authenticated
using (true);

drop policy if exists "support admins write platform admin" on public.support_admins;
create policy "support admins write platform admin"
on public.support_admins
for all
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

drop policy if exists "support admin audit read platform admin" on public.support_admin_audit;
create policy "support admin audit read platform admin"
on public.support_admin_audit
for select
to authenticated
using (public.jwt_user_is_admin());

drop policy if exists "support admin audit insert platform admin" on public.support_admin_audit;
create policy "support admin audit insert platform admin"
on public.support_admin_audit
for insert
to authenticated
with check (public.jwt_user_is_admin() and actor_id = auth.uid());

create or replace function public.jwt_user_is_support_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.support_admins sa where sa.user_id = auth.uid()
  );
$$;

create or replace function public.jwt_user_can_admin_enquiries()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.jwt_user_is_admin() or public.jwt_user_is_support_admin();
$$;

alter table public.enquiries
  add column if not exists last_reached_out_at timestamptz,
  add column if not exists last_reached_out_comment text,
  add column if not exists last_reached_out_by uuid references public.profiles(id) on delete set null;

comment on column public.enquiries.last_reached_out_comment is
  'Latest staff comment when they marked reached-out to the customer.';

-- Guard: Support admin may assign / re-tag (platform admin already could).
create or replace function public.enquiries_guard_assignee_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.jwt_user_can_admin_enquiries() then
    return new;
  end if;
  if new.assignee_id is distinct from old.assignee_id
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at
     or new.assigned_because_unknown is distinct from old.assigned_because_unknown
  then
    raise exception 'Only an admin can assign enquiries';
  end if;
  if new.tag_id is distinct from old.tag_id then
    raise exception 'Only an admin can change the enquiry tag';
  end if;
  return new;
end;
$$;

-- Recreate enquiry policies that used jwt_user_is_admin() so Support admins share them.
drop policy if exists "enquiries select scoped" on public.enquiries;
create policy "enquiries select scoped"
on public.enquiries
for select
to authenticated
using (
  public.jwt_user_can_admin_enquiries()
  or assignee_id = auth.uid()
  or created_by = auth.uid()
  or escalated_to_id = auth.uid()
  or public.enquiry_tag_visible(tag_id)
);

drop policy if exists "enquiries update admin" on public.enquiries;
create policy "enquiries update admin"
on public.enquiries
for update
to authenticated
using (public.jwt_user_can_admin_enquiries())
with check (public.jwt_user_can_admin_enquiries());

drop policy if exists "enquiries delete admin" on public.enquiries;
create policy "enquiries delete admin"
on public.enquiries
for delete
to authenticated
using (public.jwt_user_can_admin_enquiries());

drop policy if exists "enquiries insert authenticated" on public.enquiries;
create policy "enquiries insert authenticated"
on public.enquiries
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    public.jwt_user_can_admin_enquiries()
    or (assignee_id is null and assigned_by is null and assigned_at is null)
  )
);

drop policy if exists "enquiry tags write admin" on public.enquiry_tags;
create policy "enquiry tags write admin"
on public.enquiry_tags
for all
to authenticated
using (public.jwt_user_can_admin_enquiries())
with check (public.jwt_user_can_admin_enquiries());

drop policy if exists "enquiry tag members read" on public.enquiry_tag_members;
create policy "enquiry tag members read"
on public.enquiry_tag_members
for select
to authenticated
using (public.jwt_user_can_admin_enquiries() or user_id = auth.uid());

drop policy if exists "enquiry tag members write admin" on public.enquiry_tag_members;
create policy "enquiry tag members write admin"
on public.enquiry_tag_members
for all
to authenticated
using (public.jwt_user_can_admin_enquiries())
with check (public.jwt_user_can_admin_enquiries());

drop policy if exists "enquiry activity select scoped" on public.enquiry_activity_log;
create policy "enquiry activity select scoped"
on public.enquiry_activity_log
for select
to authenticated
using (
  public.jwt_user_can_admin_enquiries()
  or actor_id = auth.uid()
  or exists (
    select 1
    from public.enquiries e
    where e.id = enquiry_id
      and (
        e.assignee_id = auth.uid()
        or e.created_by = auth.uid()
        or e.escalated_to_id = auth.uid()
        or public.enquiry_tag_visible(e.tag_id)
      )
  )
);

drop policy if exists "enquiry sla escalations select scoped" on public.enquiry_sla_escalations;
create policy "enquiry sla escalations select scoped"
on public.enquiry_sla_escalations
for select
to authenticated
using (public.jwt_user_can_admin_enquiries() or recipient_user_id = auth.uid());

drop policy if exists "enquiry sla escalations insert staff" on public.enquiry_sla_escalations;
create policy "enquiry sla escalations insert staff"
on public.enquiry_sla_escalations
for insert
to authenticated
with check (
  public.jwt_user_can_admin_enquiries()
  or exists (
    select 1
    from public.enquiries e
    where e.id = enquiry_id
      and (e.assignee_id = auth.uid() or e.created_by = auth.uid())
  )
);

do $realtime$
begin
  alter publication supabase_realtime add table public.support_admins;
exception when duplicate_object then null;
end;
$realtime$;

notify pgrst, 'reload schema';
