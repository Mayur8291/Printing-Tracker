-- Internal Support Platform History: staff-raised issues.

create table if not exists public.internal_support_issues (
  id uuid primary key default gen_random_uuid(),
  raised_by uuid not null references public.profiles(id) on delete restrict,
  raised_by_name text not null,
  issue_types text[] not null,
  floor text,
  comment text not null,
  status text not null default 'Open'
    check (status in ('Open', 'In Progress', 'Resolved', 'Closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_support_issues_types_not_empty check (cardinality(issue_types) > 0),
  constraint internal_support_issues_comment_not_empty check (length(trim(comment)) > 0),
  constraint internal_support_issues_name_not_empty check (length(trim(raised_by_name)) > 0)
);

create index if not exists internal_support_issues_created_idx
  on public.internal_support_issues (created_at desc);

create index if not exists internal_support_issues_status_idx
  on public.internal_support_issues (status, created_at desc);

create or replace function public.touch_internal_support_issues_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists internal_support_issues_touch_updated_at on public.internal_support_issues;
create trigger internal_support_issues_touch_updated_at
before update on public.internal_support_issues
for each row
execute function public.touch_internal_support_issues_updated_at();

alter table public.internal_support_issues enable row level security;

drop policy if exists "internal_support_issues select authenticated" on public.internal_support_issues;
create policy "internal_support_issues select authenticated"
on public.internal_support_issues
for select
to authenticated
using (true);

drop policy if exists "internal_support_issues insert own" on public.internal_support_issues;
create policy "internal_support_issues insert own"
on public.internal_support_issues
for insert
to authenticated
with check (raised_by = auth.uid());

drop policy if exists "internal_support_issues update authenticated" on public.internal_support_issues;
create policy "internal_support_issues update authenticated"
on public.internal_support_issues
for update
to authenticated
using (true)
with check (true);

grant select, insert, update on public.internal_support_issues to authenticated;

do $realtime$
begin
  alter publication supabase_realtime add table public.internal_support_issues;
exception when duplicate_object then null;
end;
$realtime$;
