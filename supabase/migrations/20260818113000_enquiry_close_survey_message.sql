-- Queue Concierge close-feedback text when an enquiry is first closed.

alter table public.enquiries
  add column if not exists feedback_requested_at timestamptz;

create table if not exists public.enquiry_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  phone text not null,
  kind text not null default 'buttons',
  text text not null,
  buttons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists enquiry_outbound_messages_enquiry_idx
  on public.enquiry_outbound_messages (enquiry_id, created_at desc);

create unique index if not exists enquiry_outbound_messages_enquiry_uidx
  on public.enquiry_outbound_messages (enquiry_id);

grant select, insert on public.enquiry_outbound_messages to authenticated;
grant all on public.enquiry_outbound_messages to service_role;

alter table public.enquiry_outbound_messages enable row level security;

drop policy if exists "enquiry outbound select scoped" on public.enquiry_outbound_messages;
create policy "enquiry outbound select scoped"
on public.enquiry_outbound_messages
for select
to authenticated
using (
  public.jwt_user_is_admin()
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
  public.jwt_user_is_admin()
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

create or replace function public.enquiries_mark_feedback_requested()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' and new.feedback_requested_at is null then
    new.feedback_requested_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists enquiries_mark_feedback_requested on public.enquiries;
create trigger enquiries_mark_feedback_requested
before update on public.enquiries
for each row
execute function public.enquiries_mark_feedback_requested();

create or replace function public.enquiries_queue_close_survey()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msg text;
begin
  if not (new.status = 'closed' and old.status is distinct from 'closed') then
    return new;
  end if;
  if coalesce(trim(new.customer_phone), '') = '' then
    return new;
  end if;
  msg := 'I hope your issue has been resolved for Case ' || coalesce(new.enquiry_code, 'Enquiry')
    || E'.\n\nPlease provide your feedback about your experience.';
  insert into public.enquiry_outbound_messages (enquiry_id, phone, kind, text, buttons)
  values (
    new.id,
    new.customer_phone,
    'buttons',
    msg,
    '[{"id":"case_feedback","title":"Feedback"}]'::jsonb
  )
  on conflict (enquiry_id) do nothing;
  return new;
end;
$$;

drop trigger if exists enquiries_queue_close_survey on public.enquiries;
create trigger enquiries_queue_close_survey
after update on public.enquiries
for each row
execute function public.enquiries_queue_close_survey();

do $realtime$
begin
  alter publication supabase_realtime add table public.enquiry_outbound_messages;
exception when duplicate_object then null;
end;
$realtime$;
