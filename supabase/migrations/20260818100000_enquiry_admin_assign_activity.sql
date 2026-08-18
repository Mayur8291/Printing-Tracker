-- Enquiry tab: only admins may assign. Staff actions stay visible to admin.

drop policy if exists "enquiries insert authenticated" on public.enquiries;
create policy "enquiries insert authenticated"
on public.enquiries
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    public.jwt_user_is_admin()
    or (
      assignee_id is null
      and assigned_by is null
      and assigned_at is null
    )
  )
);

create or replace function public.enquiries_guard_assignee_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.jwt_user_is_admin() then
    return new;
  end if;
  if new.assignee_id is distinct from old.assignee_id
     or new.assigned_by is distinct from old.assigned_by
     or new.assigned_at is distinct from old.assigned_at
     or new.assigned_because_unknown is distinct from old.assigned_because_unknown
  then
    raise exception 'Only an admin can assign enquiries';
  end if;
  return new;
end;
$$;

drop trigger if exists enquiries_guard_assignee_change on public.enquiries;
create trigger enquiries_guard_assignee_change
before update on public.enquiries
for each row
execute function public.enquiries_guard_assignee_change();

create table if not exists public.enquiry_activity_log (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists enquiry_activity_log_enquiry_idx
  on public.enquiry_activity_log (enquiry_id, created_at desc);

alter table public.enquiry_activity_log enable row level security;

drop policy if exists "enquiry activity select scoped" on public.enquiry_activity_log;
create policy "enquiry activity select scoped"
on public.enquiry_activity_log
for select
to authenticated
using (
  public.jwt_user_is_admin()
  or actor_id = auth.uid()
  or exists (
    select 1
    from public.enquiries e
    where e.id = enquiry_id
      and (
        e.assignee_id = auth.uid()
        or e.created_by = auth.uid()
        or e.escalated_to_id = auth.uid()
      )
  )
);

drop policy if exists "enquiry activity insert actor" on public.enquiry_activity_log;
create policy "enquiry activity insert actor"
on public.enquiry_activity_log
for insert
to authenticated
with check (actor_id = auth.uid());

do $realtime$
begin
  alter publication supabase_realtime add table public.enquiry_activity_log;
exception when duplicate_object then null;
end;
$realtime$;
