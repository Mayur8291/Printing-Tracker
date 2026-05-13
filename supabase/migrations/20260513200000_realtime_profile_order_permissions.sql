-- Expose profile_order_permissions to Supabase Realtime so viewers receive updates when an admin edits their row.
-- If you see "already member of publication", the table was already enabled — safe to ignore.
alter publication supabase_realtime add table public.profile_order_permissions;
