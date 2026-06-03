alter table public.profiles
  add column if not exists job_role text,
  add column if not exists employee_id text;

comment on column public.profiles.job_role is 'Job title / role label shown in user management (e.g. Store Keeper).';
comment on column public.profiles.employee_id is 'Employee identifier (e.g. EMP001).';
