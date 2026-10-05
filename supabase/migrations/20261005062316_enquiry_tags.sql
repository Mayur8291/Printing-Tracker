-- Enquiry tags: admin-managed topic list (Pets, HR, ...) + user membership.
-- A tagged enquiry is visible/workable by admins and by users who hold that tag.
-- Complaints are untouched (tag_id stays null). Staging first.

create table if not exists public.enquiry_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists enquiry_tags_name_key
  on public.enquiry_tags (lower(btrim(name)));

create table if not exists public.enquiry_tag_members (
  tag_id uuid not null references public.enquiry_tags(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tag_id, user_id)
);

create index if not exists enquiry_tag_members_user_idx
  on public.enquiry_tag_members (user_id);

alter table public.enquiries
  add column if not exists tag_id uuid references public.enquiry_tags(id) on delete set null;

create index if not exists enquiries_tag_idx on public.enquiries (tag_id);

insert into public.enquiry_tags (name, sort_order)
values
  ('Pets', 10),
  ('HR', 20),
  ('Corporate Giftings', 30),
  ('End customer', 40),
  ('Event', 50)
on conflict do nothing;

-- ---------- RLS: tags ----------
alter table public.enquiry_tags enable row level security;

drop policy if exists "enquiry tags read" on public.enquiry_tags;
create policy "enquiry tags read"
on public.enquiry_tags
for select to authenticated
using (true);

drop policy if exists "enquiry tags write admin" on public.enquiry_tags;
create policy "enquiry tags write admin"
on public.enquiry_tags
for all to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

grant select, insert, update, delete on public.enquiry_tags to authenticated;

-- ---------- RLS: members ----------
alter table public.enquiry_tag_members enable row level security;

drop policy if exists "enquiry tag members read" on public.enquiry_tag_members;
create policy "enquiry tag members read"
on public.enquiry_tag_members
for select to authenticated
using (public.jwt_user_is_admin() or user_id = auth.uid());

drop policy if exists "enquiry tag members write admin" on public.enquiry_tag_members;
create policy "enquiry tag members write admin"
on public.enquiry_tag_members
for all to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

grant select, insert, update, delete on public.enquiry_tag_members to authenticated;

-- ---------- enquiries: tag members can read + work tagged rows ----------
create or replace function public.enquiry_tag_visible(p_tag_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_tag_id is not null
    and exists (
      select 1
      from public.enquiry_tag_members m
      where m.tag_id = p_tag_id
        and m.user_id = auth.uid()
    );
$$;

grant execute on function public.enquiry_tag_visible(uuid) to authenticated;

drop policy if exists "enquiries select scoped" on public.enquiries;
create policy "enquiries select scoped"
on public.enquiries
for select
to authenticated
using (
  public.jwt_user_is_admin()
  or assignee_id = auth.uid()
  or created_by = auth.uid()
  or escalated_to_id = auth.uid()
  or public.enquiry_tag_visible(tag_id)
);

drop policy if exists "enquiries update tag member" on public.enquiries;
create policy "enquiries update tag member"
on public.enquiries
for update
to authenticated
using (public.enquiry_tag_visible(tag_id))
with check (public.enquiry_tag_visible(tag_id));

-- Only admin may re-tag (same guard that blocks non-admin assignee edits).
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
  if new.tag_id is distinct from old.tag_id then
    raise exception 'Only an admin can change the enquiry tag';
  end if;
  return new;
end;
$$;

-- ---------- realtime ----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'enquiry_tags'
  ) then
    alter publication supabase_realtime add table public.enquiry_tags;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'enquiry_tag_members'
  ) then
    alter publication supabase_realtime add table public.enquiry_tag_members;
  end if;
end
$$;

notify pgrst, 'reload schema';
