-- Staging: dashboard presence for chat Online / Away / Offline.

create table if not exists public.hr_user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  client_state text not null check (client_state in ('online', 'away')),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hr_user_presence_last_seen_idx
  on public.hr_user_presence (last_seen_at desc);

alter table public.hr_user_presence enable row level security;

drop policy if exists "hr presence select authenticated" on public.hr_user_presence;
create policy "hr presence select authenticated"
on public.hr_user_presence
for select
to authenticated
using (auth.uid() is not null);

create or replace function public.set_my_dashboard_presence(p_client_state text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := lower(trim(coalesce(p_client_state, '')));
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if clean not in ('online', 'away') then
    raise exception 'Invalid presence state';
  end if;

  insert into public.hr_user_presence (user_id, client_state, last_seen_at, updated_at)
  values (me, clean, now(), now())
  on conflict (user_id) do update
    set client_state = excluded.client_state,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.set_my_dashboard_presence(text) from public;
grant execute on function public.set_my_dashboard_presence(text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'hr_user_presence'
  ) then
    alter publication supabase_realtime add table public.hr_user_presence;
  end if;
end
$$;

notify pgrst, 'reload schema';
