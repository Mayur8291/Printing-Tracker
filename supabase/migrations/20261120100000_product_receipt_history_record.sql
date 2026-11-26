-- Keep the product-receipt decision, reason, and proof link on the order history row.

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
  proof text := nullif(btrim(coalesce(new.product_received_proof_url, '')), '');
  outcome text;
  detail text;
begin
  if new.product_received_at is not distinct from old.product_received_at
     and new.product_received_by is not distinct from old.product_received_by
     and new.product_received_issue is not distinct from old.product_received_issue
     and new.product_received_proof_url is not distinct from old.product_received_proof_url then
    return new;
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'User')
    into actor_name
  from public.profiles
  where id = actor;

  if new.product_received_at is null then
    outcome := 'cleared';
    detail := 'Product receipt cleared.';
  elsif issue is not null then
    outcome := 'issue';
    detail := 'Product received with an issue: ' || issue || '.';
  elsif old_issue is not null then
    outcome := 'cleared_issue';
    detail := 'Product issue cleared. The product matches the job.';
  else
    outcome := 'received';
    detail := 'Product received and checked against the job.';
  end if;

  if proof is not null and new.product_received_at is not null then
    detail := detail || ' Proof: ' || proof;
  end if;

  insert into public.order_activity_log (
    order_id, event_type, message, meta, actor_id, actor_label
  )
  values (
    new.id,
    case when issue is not null then 'product_received_issue' else 'product_received' end,
    detail,
    jsonb_strip_nulls(jsonb_build_object(
      'outcome', outcome,
      'proof_url', proof,
      'issue', issue,
      'previous_issue', old_issue
    )),
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

drop trigger if exists trg_log_product_receipt on public.orders;
create trigger trg_log_product_receipt
after update of product_received_at, product_received_by, product_received_proof_url, product_received_issue
on public.orders
for each row
execute function public.log_product_receipt();
