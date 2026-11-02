-- On-hold alerts include the typed reason for the person who created the job.

alter table public.order_status_notifications
  add column if not exists note text;

comment on column public.order_status_notifications.note is
  'Extra text for the alert. On hold stores the reason.';

create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  coord_user_id uuid;
  actor_id uuid;
  hold_note text;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  actor_id := auth.uid();
  hold_note := case
    when new.status = 'on_hold' then nullif(trim(new.on_hold_reason), '')
    else null
  end;

  if trim(coalesce(new.coordinator_name, '')) <> '' then
    select p.id into coord_user_id
    from public.profiles p
    where trim(coalesce(p.full_name, '')) <> ''
      and lower(trim(p.full_name)) = lower(trim(new.coordinator_name))
    limit 1;
  end if;

  -- Creator must hear about On hold, even when they are also the coordinator.
  -- Skip the person who made the change.
  if new.created_by is not null
     and new.created_by is distinct from actor_id
     and (
       new.status = 'on_hold'
       or new.created_by is distinct from coord_user_id
     ) then
    insert into public.order_status_notifications (
      recipient_user_id,
      order_id,
      order_display_id,
      previous_status,
      new_status,
      changed_by_user_id,
      note
    ) values (
      new.created_by,
      new.id,
      new.order_id,
      old.status,
      new.status,
      actor_id,
      hold_note
    );
  end if;

  if coord_user_id is not null
     and coord_user_id is distinct from actor_id
     and coord_user_id is distinct from new.created_by then
    insert into public.order_status_notifications (
      recipient_user_id,
      order_id,
      order_display_id,
      previous_status,
      new_status,
      changed_by_user_id,
      note
    ) values (
      coord_user_id,
      new.id,
      new.order_id,
      old.status,
      new.status,
      actor_id,
      hold_note
    );
  end if;

  return new;
end;
$$;
