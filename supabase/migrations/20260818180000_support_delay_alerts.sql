-- Production delay alerts from Support (admin and staff). Queue WhatsApp-simulator copy.

alter table public.enquiry_outbound_messages
  alter column enquiry_id drop not null;

drop index if exists public.enquiry_outbound_messages_enquiry_uidx;

create unique index if not exists enquiry_outbound_messages_close_survey_uidx
  on public.enquiry_outbound_messages (enquiry_id)
  where enquiry_id is not null;

drop policy if exists "enquiry outbound select scoped" on public.enquiry_outbound_messages;
create policy "enquiry outbound select scoped"
on public.enquiry_outbound_messages
for select
to authenticated
using (
  enquiry_id is null
  or public.jwt_user_is_admin()
  or exists (
    select 1
    from public.enquiries e
    where e.id = enquiry_id
      and (
        e.assignee_id = auth.uid()
        or e.created_by = auth.uid()
        or e.escalated_to_id = auth.uid()
      )
  )
);

drop policy if exists "enquiry outbound insert staff" on public.enquiry_outbound_messages;
create policy "enquiry outbound insert staff"
on public.enquiry_outbound_messages
for insert
to authenticated
with check (
  enquiry_id is null
  or public.jwt_user_is_admin()
  or exists (
    select 1
    from public.enquiries e
    where e.id = enquiry_id
      and (
        e.assignee_id = auth.uid()
        or e.created_by = auth.uid()
        or e.escalated_to_id = auth.uid()
      )
  )
);

create table if not exists public.support_delay_alerts (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  customer_name text,
  phone text not null,
  old_delivery_date date,
  new_delivery_date date not null,
  reason text not null default 'Production delay',
  message text not null,
  sent_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists support_delay_alerts_created_idx
  on public.support_delay_alerts (created_at desc);

grant select, insert on public.support_delay_alerts to authenticated;
grant all on public.support_delay_alerts to service_role;

alter table public.support_delay_alerts enable row level security;

drop policy if exists "support delay alerts select authenticated" on public.support_delay_alerts;
create policy "support delay alerts select authenticated"
on public.support_delay_alerts
for select
to authenticated
using (true);

drop policy if exists "support delay alerts insert authenticated" on public.support_delay_alerts;
create policy "support delay alerts insert authenticated"
on public.support_delay_alerts
for insert
to authenticated
with check (sent_by = auth.uid());

do $realtime$
begin
  alter publication supabase_realtime add table public.support_delay_alerts;
exception when duplicate_object then null;
end;
$realtime$;
