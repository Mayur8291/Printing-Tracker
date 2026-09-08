-- Admin-editable Sampling Tracker SLA (fallback when Sampling required on is empty).
-- Qty / money rules unchanged. Staging first.

create table if not exists public.sample_job_sheet_settings (
  id integer primary key default 1 check (id = 1),
  default_sla_days integer not null default 2 check (default_sla_days between 1 and 30),
  default_sla_hours integer not null default 0 check (default_sla_hours between 0 and 23),
  warn_hours integer not null default 24 check (warn_hours between 1 and 168),
  urgent_hours integer not null default 12 check (urgent_hours between 1 and 168),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.sample_job_sheet_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.sample_job_sheet_settings enable row level security;

drop policy if exists "sample job sheet settings read" on public.sample_job_sheet_settings;
create policy "sample job sheet settings read"
on public.sample_job_sheet_settings
for select to authenticated
using (true);

drop policy if exists "sample job sheet settings write admin" on public.sample_job_sheet_settings;
create policy "sample job sheet settings write admin"
on public.sample_job_sheet_settings
for all to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

grant select, insert, update on public.sample_job_sheet_settings to authenticated;

notify pgrst, 'reload schema';
