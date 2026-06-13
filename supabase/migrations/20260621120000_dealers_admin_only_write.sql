-- Only admins may add or remove (deactivate) dealers.
-- Distributor tab editors can still save daily report amounts.

drop policy if exists "dealers insert distributor edit" on public.dealers;
drop policy if exists "dealers update distributor edit" on public.dealers;

drop policy if exists "dealers insert admin" on public.dealers;
create policy "dealers insert admin"
on public.dealers for insert to authenticated
with check (public.jwt_user_is_admin());

drop policy if exists "dealers update admin" on public.dealers;
create policy "dealers update admin"
on public.dealers for update to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());
