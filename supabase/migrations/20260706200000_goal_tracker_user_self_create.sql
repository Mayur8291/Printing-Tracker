-- Allow users to create their own annual goals (user_id = created_by = auth.uid()).

drop policy if exists "annual goals owner insert" on public.user_annual_goals;
create policy "annual goals owner insert"
on public.user_annual_goals
for insert
to authenticated
with check (
  user_id = auth.uid()
  and created_by = auth.uid()
);
