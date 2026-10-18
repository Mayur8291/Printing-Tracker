-- Once status is Resolved, nobody (including admin) can change it.

drop policy if exists "internal_support_issues update admin" on public.internal_support_issues;
create policy "internal_support_issues update admin"
on public.internal_support_issues
for update
to authenticated
using (public.jwt_user_is_admin() and status <> 'Resolved')
with check (public.jwt_user_is_admin());
