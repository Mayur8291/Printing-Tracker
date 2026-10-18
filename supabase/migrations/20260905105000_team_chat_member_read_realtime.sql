-- Realtime RLS needs the full old/new member row so peer last_read_at updates reach other members.

alter table public.team_chat_conversation_members replica identity full;

do $realtime$
begin
  alter publication supabase_realtime add table public.team_chat_conversation_members;
exception
  when duplicate_object then null;
end;
$realtime$;
