-- Auto-delete chat attachments (storage + DB fields) 24 hours after the message was sent.
-- Message text stays unless the message was attachment-only (then the row is removed).

create or replace function public.purge_expired_team_chat_attachments()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  purged_count integer := 0;
  rec record;
begin
  for rec in
    select id, attachment_path, body
    from public.team_chat_messages
    where nullif(trim(attachment_path), '') is not null
      and created_at <= (now() - interval '24 hours')
  loop
    delete from storage.objects
    where bucket_id = 'team-chat-files'
      and name = rec.attachment_path;

    if char_length(trim(coalesce(rec.body, ''))) < 1 then
      delete from public.team_chat_messages
      where id = rec.id;
    else
      update public.team_chat_messages
      set
        attachment_path = null,
        attachment_name = null,
        attachment_mime = null,
        attachment_size = null
      where id = rec.id;
    end if;

    purged_count := purged_count + 1;
  end loop;

  return purged_count;
end;
$$;

revoke all on function public.purge_expired_team_chat_attachments() from public;
grant execute on function public.purge_expired_team_chat_attachments() to service_role;

create extension if not exists pg_cron with schema extensions;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'purge-expired-team-chat-attachments') then
    perform cron.unschedule('purge-expired-team-chat-attachments');
  end if;
end;
$cron$;

select cron.schedule(
  'purge-expired-team-chat-attachments',
  '15 * * * *',
  $$select public.purge_expired_team_chat_attachments();$$
);
