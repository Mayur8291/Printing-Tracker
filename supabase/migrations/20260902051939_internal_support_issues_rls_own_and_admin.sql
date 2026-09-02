-- History: admin sees all rows and can change status.
-- Non-admin sees only own rows and cannot update status.

create index if not exists internal_support_issues_raised_by_idx
  on public.internal_support_issues (raised_by, created_at desc);

drop policy if exists "internal_support_issues select authenticated" on public.internal_support_issues;
drop policy if exists "internal_support_issues select own or admin" on public.internal_support_issues;
create policy "internal_support_issues select own or admin"
on public.internal_support_issues
for select
to authenticated
using (
  raised_by = auth.uid()
  or public.jwt_user_is_admin()
);

drop policy if exists "internal_support_issues update authenticated" on public.internal_support_issues;
drop policy if exists "internal_support_issues update admin" on public.internal_support_issues;
create policy "internal_support_issues update admin"
on public.internal_support_issues
for update
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());
