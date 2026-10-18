-- Staging: last_seen_at only moves while the dashboard is focused.
-- Display stays Online for 5 minutes after they leave, then Away, then Offline at 2 hours.

create or replace function public.set_my_dashboard_presence(p_client_state text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := lower(trim(coalesce(p_client_state, '')));
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if clean not in ('online', 'away') then
    raise exception 'Invalid presence state';
  end if;

  insert into public.hr_user_presence (user_id, client_state, last_seen_at, updated_at)
  values (me, clean, now(), now())
  on conflict (user_id) do update
    set client_state = excluded.client_state,
        last_seen_at = case
          when excluded.client_state = 'online' then now()
          else public.hr_user_presence.last_seen_at
        end,
        updated_at = now();
end;
$$;
