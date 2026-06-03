-- Per-user toggle to enable / disable status-change tones (default on).

alter table public.profiles
  add column if not exists status_tones_enabled boolean not null default true;

comment on column public.profiles.status_tones_enabled is
  'When false, the user does not hear status-change or overdue-ready tones in the dashboard.';
