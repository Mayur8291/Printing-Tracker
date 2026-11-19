-- When a printing order is marked with a product issue, alert the person who created the job.

create or replace function public.log_product_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text := 'User';
  issue text := nullif(btrim(coalesce(new.product_received_issue, '')), '');
  old_issue text := nullif(btrim(coalesce(old.product_received_issue, '')), '');
begin
  if new.product_received_at is not distinct from old.product_received_at
     and new.product_received_issue is not distinct from old.product_received_issue
     and new.product_received_proof_url is not distinct from old.product_received_proof_url then
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'User')
    into actor_name
  from public.profiles
  where id = actor;

  insert into public.order_activity_log (order_id, event_type, message, actor_id, actor_label)
  values (
    new.id,
    case when issue is not null then 'product_received_issue' else 'product_received' end,
    case
      when new.product_received_at is null then 'Product receipt cleared.'
      when issue is not null then 'Product received with an issue: ' || issue
      else 'Product received and checked against the job. Proof saved.'
    end,
    actor,
    coalesce(actor_name, 'User')
  );

  if issue is not null
     and issue is distinct from old_issue
     and new.created_by is not null
     and new.created_by is distinct from actor then
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
      'product_issue',
      actor,
      issue
    );
  end if;

  return new;
end;
$$;
