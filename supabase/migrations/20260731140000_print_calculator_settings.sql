-- DTF / print cost calculator: admin-configurable rate per square inch.

create table if not exists public.print_calculator_settings (
  id int primary key default 1 check (id = 1),
  rate_per_sq_in numeric(14, 4) not null default 1 check (rate_per_sq_in > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.print_calculator_settings (id, rate_per_sq_in)
values (1, 1)
on conflict (id) do nothing;

alter table public.print_calculator_settings enable row level security;

drop policy if exists "print calculator settings read" on public.print_calculator_settings;
create policy "print calculator settings read"
on public.print_calculator_settings for select to authenticated using (true);

drop policy if exists "print calculator settings write" on public.print_calculator_settings;
create policy "print calculator settings write"
on public.print_calculator_settings for all to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

comment on table public.print_calculator_settings is
  'Singleton settings for Print Calculator: rate per square inch (formula uses (H+1)×(W+1)×rate).';

notify pgrst, 'reload schema';
