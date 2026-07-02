-- Profile avatars for dashboard users (profiles table).

alter table public.profiles add column if not exists avatar_path text;

insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "profile avatars read authenticated" on storage.objects;
create policy "profile avatars read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'profile-avatars');

drop policy if exists "profile avatars upload own or admin" on storage.objects;
create policy "profile avatars upload own or admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

drop policy if exists "profile avatars update own or admin" on storage.objects;
create policy "profile avatars update own or admin"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
)
with check (
  bucket_id = 'profile-avatars'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

drop policy if exists "profile avatars delete own or admin" on storage.objects;
create policy "profile avatars delete own or admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);
