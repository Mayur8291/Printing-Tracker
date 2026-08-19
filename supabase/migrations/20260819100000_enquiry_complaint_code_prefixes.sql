-- Split Support tickets: Enquiries keep ENQ-#####, Complaints use CS-#####.
-- Same public.enquiries table (already matches the Complaints column set).

create sequence if not exists public.complaint_code_seq start 1;

alter table public.enquiries
  add column if not exists ticket_kind text;

update public.enquiries
set ticket_kind = case
  when help_topic = 'enquiry' then 'enquiry'
  else 'complaint'
end
where ticket_kind is null;

alter table public.enquiries
  alter column ticket_kind set default 'enquiry';

alter table public.enquiries
  alter column ticket_kind set not null;

alter table public.enquiries drop constraint if exists enquiries_ticket_kind_check;
alter table public.enquiries
  add constraint enquiries_ticket_kind_check
  check (ticket_kind in ('enquiry', 'complaint'));

alter table public.enquiries
  alter column source set default 'WhatsApp';

create index if not exists enquiries_ticket_kind_created_idx
  on public.enquiries (ticket_kind, created_at desc);

-- Relabel existing complaint rows ENQ-00002 → CS-00002 (number kept).
update public.enquiries
set enquiry_code = 'CS-' || lpad(regexp_replace(enquiry_code, '\D', '', 'g'), 5, '0')
where ticket_kind = 'complaint'
  and enquiry_code ~ '^ENQ-[0-9]+$';

update public.enquiry_assignment_notifications n
set enquiry_code = e.enquiry_code
from public.enquiries e
where n.enquiry_id = e.id
  and n.enquiry_code is distinct from e.enquiry_code;

update public.enquiry_sla_escalations n
set enquiry_code = e.enquiry_code
from public.enquiries e
where n.enquiry_id = e.id
  and n.enquiry_code is distinct from e.enquiry_code;

create or replace function public.set_enquiry_code()
returns trigger
language plpgsql
as $$
declare
  kind text;
begin
  kind := case
    when coalesce(nullif(trim(new.ticket_kind), ''), '') = 'complaint' then 'complaint'
    when coalesce(nullif(trim(new.ticket_kind), ''), '') = 'enquiry' then 'enquiry'
    when new.help_topic in ('regular', 'product_issue') then 'complaint'
    when new.help_topic = 'enquiry' then 'enquiry'
    else 'enquiry'
  end;
  new.ticket_kind := kind;

  if new.enquiry_code is null or trim(new.enquiry_code) = '' then
    if kind = 'complaint' then
      new.enquiry_code := 'CS-' || lpad(nextval('public.complaint_code_seq')::text, 5, '0');
    else
      new.enquiry_code := 'ENQ-' || lpad(nextval('public.enquiry_code_seq')::text, 5, '0');
    end if;
  end if;

  return new;
end;
$$;

select setval(
  'public.enquiry_code_seq',
  greatest(
    coalesce((select last_value from public.enquiry_code_seq), 1),
    coalesce((
      select max(regexp_replace(enquiry_code, '\D', '', 'g')::int)
      from public.enquiries
      where enquiry_code ~ '^ENQ-[0-9]+$'
    ), 0)
  ),
  true
);

select setval(
  'public.complaint_code_seq',
  greatest(
    1,
    coalesce((
      select max(regexp_replace(enquiry_code, '\D', '', 'g')::int)
      from public.enquiries
      where enquiry_code ~ '^CS-[0-9]+$'
    ), 0)
  ),
  (
    select coalesce(max(regexp_replace(enquiry_code, '\D', '', 'g')::int), 0) > 0
    from public.enquiries
    where enquiry_code ~ '^CS-[0-9]+$'
  )
);

notify pgrst, 'reload schema';
