-- Per-user custom notification tone (MP3 in storage).

alter table public.profiles
  add column if not exists notification_tone_path text;

comment on column public.profiles.notification_tone_path is
  'Storage path in notification-tones bucket for user-uploaded MP3 alert sound.';

insert into storage.buckets (id, name, public)
values ('notification-tones', 'notification-tones', true)
on conflict (id) do update set public = true;

drop policy if exists "notification tones read authenticated" on storage.objects;
create policy "notification tones read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'notification-tones');

drop policy if exists "notification tones upload own or admin" on storage.objects;
create policy "notification tones upload own or admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'notification-tones'
  and lower(storage.extension(name)) = 'mp3'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

drop policy if exists "notification tones update own or admin" on storage.objects;
create policy "notification tones update own or admin"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'notification-tones'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
)
with check (
  bucket_id = 'notification-tones'
  and lower(storage.extension(name)) = 'mp3'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

drop policy if exists "notification tones delete own or admin" on storage.objects;
create policy "notification tones delete own or admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'notification-tones'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);
