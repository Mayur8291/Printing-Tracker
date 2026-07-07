-- Goal task assignment + order status change notifications.

create table if not exists public.user_goal_task_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.user_goal_tasks(id) on delete cascade,
  task_title text not null,
  goal_id uuid references public.user_annual_goals(id) on delete set null,
  goal_title text,
  assigned_by_user_id uuid not null references public.profiles(id) on delete cascade,
  deadline_date date,
  created_at timestamptz not null default now()
);

create index if not exists user_goal_task_notifications_recipient_idx
  on public.user_goal_task_notifications (recipient_user_id, created_at desc);

create table if not exists public.order_status_notifications (
  id bigint generated always as identity primary key,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  order_id bigint not null references public.orders(id) on delete cascade,
  order_display_id text,
  previous_status text,
  new_status text not null,
  changed_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_status_notifications_recipient_idx
  on public.order_status_notifications (recipient_user_id, created_at desc);

alter table public.user_goal_task_notifications enable row level security;
alter table public.order_status_notifications enable row level security;

drop policy if exists "goal task notifications read own" on public.user_goal_task_notifications;
create policy "goal task notifications read own"
on public.user_goal_task_notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

drop policy if exists "goal task notifications insert" on public.user_goal_task_notifications;
create policy "goal task notifications insert"
on public.user_goal_task_notifications
for insert
to authenticated
with check (assigned_by_user_id = auth.uid());

drop policy if exists "order status notifications read own" on public.order_status_notifications;
create policy "order status notifications read own"
on public.order_status_notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

-- Inserts only via security definer trigger below.

create or replace function public.notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  coord_user_id uuid;
  actor_id uuid;
begin
  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  actor_id := auth.uid();

  if trim(coalesce(NEW.coordinator_name, '')) <> '' then
    select p.id into coord_user_id
    from public.profiles p
    where trim(coalesce(p.full_name, '')) <> ''
      and lower(trim(p.full_name)) = lower(trim(NEW.coordinator_name))
    limit 1;
  end if;

  if coord_user_id is not null and coord_user_id is distinct from actor_id then
    insert into public.order_status_notifications (
      recipient_user_id,
      order_id,
      order_display_id,
      previous_status,
      new_status,
      changed_by_user_id
    ) values (
      coord_user_id,
      NEW.id,
      NEW.order_id,
      OLD.status,
      NEW.status,
      actor_id
    );
  end if;

  if NEW.created_by is not null
     and NEW.created_by is distinct from actor_id
     and NEW.created_by is distinct from coord_user_id then
    insert into public.order_status_notifications (
      recipient_user_id,
      order_id,
      order_display_id,
      previous_status,
      new_status,
      changed_by_user_id
    ) values (
      NEW.created_by,
      NEW.id,
      NEW.order_id,
      OLD.status,
      NEW.status,
      actor_id
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists orders_status_notify on public.orders;
create trigger orders_status_notify
after update of status on public.orders
for each row
execute function public.notify_order_status_change();

do $realtime$
begin
  alter publication supabase_realtime add table public.user_goal_task_notifications;
exception when duplicate_object then null;
end;
$realtime$;

do $realtime$
begin
  alter publication supabase_realtime add table public.order_status_notifications;
exception when duplicate_object then null;
end;
$realtime$;
