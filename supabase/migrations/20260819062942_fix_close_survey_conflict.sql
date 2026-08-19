-- Close must not fail when delay alerts made enquiry_id unique only as a partial index.
-- ON CONFLICT (enquiry_id) needs a non-partial unique constraint; staging no longer has one.

create unique index if not exists enquiry_outbound_messages_close_survey_uidx
  on public.enquiry_outbound_messages (enquiry_id)
  where enquiry_id is not null;

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
  if exists (
    select 1
    from public.enquiry_outbound_messages m
    where m.enquiry_id = new.id
  ) then
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
  );

  return new;
exception
  when unique_violation then
    return new;
  when others then
    raise warning 'enquiries_queue_close_survey: %', sqlerrm;
    return new;
end;
$$;

notify pgrst, 'reload schema';
