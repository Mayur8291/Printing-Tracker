-- Tag users on inward entries and notify tagged users (bell + realtime).

create table if not exists public.inward_entry_tags (
  id bigint generated always as identity primary key,
  inward_entry_id bigint not null references public.inward_entries(id) on delete cascade,
  tagged_user_id uuid not null references public.profiles(id) on delete cascade,
  tagged_by_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (inward_entry_id, tagged_user_id)
);

create index if not exists inward_entry_tags_entry_idx
  on public.inward_entry_tags (inward_entry_id);

alter table public.inward_entry_tags enable row level security;

drop policy if exists "inward entry tags read authenticated" on public.inward_entry_tags;
create policy "inward entry tags read authenticated"
on public.inward_entry_tags
for select
to authenticated
using (true);

drop policy if exists "inward entry tags insert dispatch edit" on public.inward_entry_tags;
create policy "inward entry tags insert dispatch edit"
on public.inward_entry_tags
for insert
to authenticated
with check (
  tagged_by_user_id = auth.uid()
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
  )
);

create table if not exists public.inward_entry_notifications (
  id bigint generated always as identity primary key,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  inward_entry_id bigint not null references public.inward_entries(id) on delete cascade,
  product_material text not null default '',
  department text not null default '',
  grn_no text not null default '',
  tagged_by_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists inward_entry_notifications_recipient_created_idx
  on public.inward_entry_notifications (recipient_user_id, created_at desc);

alter table public.inward_entry_notifications enable row level security;

drop policy if exists "inward entry notifications read own" on public.inward_entry_notifications;
create policy "inward entry notifications read own"
on public.inward_entry_notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

drop policy if exists "inward entry notifications insert dispatch edit" on public.inward_entry_notifications;
create policy "inward entry notifications insert dispatch edit"
on public.inward_entry_notifications
for insert
to authenticated
with check (
  tagged_by_user_id = auth.uid()
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
  )
);

do $realtime$
begin
  alter publication supabase_realtime add table public.inward_entry_notifications;
exception
  when duplicate_object then null;
end;
$realtime$;
