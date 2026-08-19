-- When production (or any staff) changes orders.status, queue Concierge WhatsApp copy.
-- Track Order is removed from the simulator; customers get status texts automatically.

create table if not exists public.support_production_status_alerts (
  id uuid primary key default gen_random_uuid(),
  order_uuid uuid references public.orders(id) on delete set null,
  order_id text not null,
  customer_name text,
  phone text,
  old_status text,
  new_status text not null,
  message text not null,
  skipped_reason text,
  created_at timestamptz not null default now()
);

create index if not exists support_production_status_alerts_created_idx
  on public.support_production_status_alerts (created_at desc);

grant select on public.support_production_status_alerts to authenticated;
grant all on public.support_production_status_alerts to service_role;

alter table public.support_production_status_alerts enable row level security;

drop policy if exists "support production status alerts select" on public.support_production_status_alerts;
create policy "support production status alerts select"
on public.support_production_status_alerts
for select
to authenticated
using (true);

create or replace function public.queue_production_status_customer_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_name text;
  v_code text;
  v_label text;
  v_msg text;
  v_skip text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_code := coalesce(nullif(trim(new.order_id), ''), new.id::text);
  v_name := coalesce(nullif(trim(new.customer_name), ''), 'customer');
  v_label := public.status_label(new.status);

  select e.customer_phone
    into v_phone
  from public.enquiries e
  where e.customer_phone is not null
    and length(regexp_replace(e.customer_phone, '\D', '', 'g')) >= 10
    and upper(regexp_replace(coalesce(e.order_id, ''), '\s', '', 'g'))
      = upper(regexp_replace(v_code, '\s', '', 'g'))
  order by e.created_at desc
  limit 1;

  if v_phone is null and v_name <> 'customer' then
    select coalesce(nullif(trim(c.contact_number), ''), nullif(trim(c.alternate_contact_number), ''))
      into v_phone
    from public.contact_book_entries c
    where lower(trim(c.name)) = lower(trim(v_name))
      and (
        length(regexp_replace(coalesce(c.contact_number, ''), '\D', '', 'g')) >= 10
        or length(regexp_replace(coalesce(c.alternate_contact_number, ''), '\D', '', 'g')) >= 10
      )
    order by c.updated_at desc
    limit 1;
  end if;

  if v_phone is null then
    select coalesce(
      nullif(trim(s.customer->>'phone'), ''),
      nullif(trim(s.customer->>'mobile'), ''),
      nullif(trim(s.customer->>'contact_number'), '')
    )
      into v_phone
    from public.scott_orders s
    where upper(trim(s.order_code)) = upper(trim(v_code))
       or s.id::text = v_code
    limit 1;
  end if;

  if v_phone is null or length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then
    v_skip := 'No customer phone on a matching enquiry, contact book, or Ready Stock order';
    v_phone := null;
  else
    v_skip := null;
  end if;

  v_msg := format(
    E'Hi %s, this is Scott Concierge.\nYour order %s has a production update.\nStatus is now: %s.\nWe will keep you posted.',
    v_name,
    v_code,
    v_label
  );

  insert into public.support_production_status_alerts (
    order_uuid, order_id, customer_name, phone, old_status, new_status, message, skipped_reason
  ) values (
    new.id, v_code, v_name, v_phone, old.status, new.status, v_msg, v_skip
  );

  if v_skip is null then
    insert into public.enquiry_outbound_messages (enquiry_id, phone, kind, text, buttons)
    values
      (null, v_phone, 'production_status', v_msg, '[]'::jsonb),
      (
        null,
        v_phone,
        'buttons',
        'What would you like to do next?',
        '[{"id":"menu_help","title":"Help with order"},{"id":"menu_access","title":"Customer Access"}]'::jsonb
      );
  end if;

  return new;
end;
$$;

drop trigger if exists orders_queue_production_status_whatsapp on public.orders;
create trigger orders_queue_production_status_whatsapp
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function public.queue_production_status_customer_message();

do $realtime$
begin
  alter publication supabase_realtime add table public.support_production_status_alerts;
exception when duplicate_object then null;
end;
$realtime$;

notify pgrst, 'reload schema';
