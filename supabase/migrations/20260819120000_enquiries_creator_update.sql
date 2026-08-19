-- Creators may update their own enquiry (attach photos after insert).
-- Non-admin still cannot assign: enquiries_guard_assignee_change blocks assignee fields.

drop policy if exists "enquiries update creator" on public.enquiries;
create policy "enquiries update creator"
on public.enquiries
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

notify pgrst, 'reload schema';
