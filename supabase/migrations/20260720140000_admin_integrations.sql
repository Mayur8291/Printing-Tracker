-- Admin integrations settings: API keys, channels, facility mapping UI.
-- API keys are stored as SHA-256 hashes only (plaintext shown once in the UI);
-- the dashboard-stock-api edge function accepts either the DASHBOARD_API_KEY
-- secret (legacy) or any active key from dashboard_api_keys.

-- 1) API keys -----------------------------------------------------------------

create table if not exists public.dashboard_api_keys (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  username text not null default '',
  key_prefix text not null,
  key_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

comment on table public.dashboard_api_keys is
  'M2M API keys for dashboard-stock-api (stock + order routes). key_hash = sha256 hex of the full key; plaintext never stored.';

alter table public.dashboard_api_keys enable row level security;
revoke all on public.dashboard_api_keys from public;

drop policy if exists "api keys admin all" on public.dashboard_api_keys;
create policy "api keys admin all"
on public.dashboard_api_keys
for all
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

grant select, insert, update, delete on public.dashboard_api_keys to authenticated;
grant select, update on public.dashboard_api_keys to service_role;

-- 2) Channels -----------------------------------------------------------------

create table if not exists public.dashboard_channels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  channel_type text not null default 'CUSTOM'
    check (channel_type in ('CUSTOM', 'MOBILE_APP', 'SHOPIFY', 'AMAZON', 'FLIPKART', 'MYNTRA', 'JIOMART', 'OTHER')),
  enabled boolean not null default true,
  api_key_id uuid references public.dashboard_api_keys(id) on delete set null,
  default_facility_code text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dashboard_channels is
  'Sales channel registry (order sources). Registry/config only — order intake auth is via API keys.';

alter table public.dashboard_channels enable row level security;
revoke all on public.dashboard_channels from public;

drop policy if exists "channels admin all" on public.dashboard_channels;
create policy "channels admin all"
on public.dashboard_channels
for all
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

grant select, insert, update, delete on public.dashboard_channels to authenticated;
grant select on public.dashboard_channels to service_role;

notify pgrst, 'reload schema';
