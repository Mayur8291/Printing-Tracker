alter table public.profiles
  add column if not exists is_active boolean not null default true;

comment on column public.profiles.is_active is 'When false, user is marked inactive in admin user management.';
