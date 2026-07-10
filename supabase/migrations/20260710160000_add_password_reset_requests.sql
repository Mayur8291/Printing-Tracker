-- Admin-approved password reset requests (login screen forgot-password flow).

create table if not exists public.password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  requester_role text not null default 'viewer'
    check (requester_role in ('viewer', 'admin')),
  routing text not null default 'panel_admin'
    check (routing in ('panel_admin', 'main_admin')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'completed')),
  admin_note text,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  approved_expires_at timestamptz,
  completed_at timestamptz
);

comment on table public.password_reset_requests is
  'User-initiated password reset requests. Admin approves; user sets new password on login screen only.';
comment on column public.password_reset_requests.routing is
  'panel_admin = any dashboard admin may approve; main_admin = only admin@scott.com may approve (admin users).';

create index if not exists password_reset_requests_status_requested_idx
  on public.password_reset_requests (status, requested_at desc);

create index if not exists password_reset_requests_user_id_idx
  on public.password_reset_requests (user_id);

create unique index if not exists password_reset_requests_one_open_per_user
  on public.password_reset_requests (user_id)
  where status in ('pending', 'approved');

alter table public.password_reset_requests enable row level security;

drop policy if exists "password reset requests admin select" on public.password_reset_requests;
create policy "password reset requests admin select"
on public.password_reset_requests
for select
to authenticated
using (public.jwt_user_is_admin());

drop policy if exists "password reset requests admin update" on public.password_reset_requests;
create policy "password reset requests admin update"
on public.password_reset_requests
for update
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

-- Public insert/update via Edge Functions (service role). Realtime for admin panel.
do $$
begin
  alter publication supabase_realtime add table public.password_reset_requests;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
