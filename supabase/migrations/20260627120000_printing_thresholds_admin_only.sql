-- Restrict printing inventory threshold edits to admins only.

drop policy if exists "printing dept thresholds write" on public.printing_dept_inventory_thresholds;
create policy "printing dept thresholds write"
on public.printing_dept_inventory_thresholds
for all
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());
