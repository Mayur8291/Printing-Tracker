-- Repeat-order templates are a team catalog. Any signed-in user may SELECT
-- (Use). Insert stays own user_id. Update/delete stay owner or admin.

drop policy if exists "order templates read own" on public.order_templates;
create policy "order templates read authenticated"
on public.order_templates
for select
to authenticated
using (true);

comment on table public.order_templates is
  'Repeat-order templates. All authenticated users can read. Write is owner or admin.';

notify pgrst, 'reload schema';
