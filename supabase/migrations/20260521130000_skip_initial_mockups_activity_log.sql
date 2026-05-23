-- Do not log mockups on job create; mockups are required at creation (non-admin one-time flow).

create or replace function public.log_order_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text := 'System';
  old_imgs int;
  new_imgs int;
  added_imgs int;
begin
  if actor is not null then
    select coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'User')
    into actor_name
    from public.profiles p
    where p.id = actor;
  end if;

  if TG_OP = 'INSERT' then
    insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
    values (
      new.id,
      'order_created',
      format('Job created for %s', new.customer_name),
      jsonb_build_object(
        'status', new.status,
        'order_id', new.order_id,
        'qty', new.qty
      ),
      actor,
      actor_name
    );

    return new;
  end if;

  if TG_OP = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'status_changed',
        format(
          'Status updated: %s → %s',
          public.status_label(old.status),
          public.status_label(new.status)
        ),
        jsonb_build_object('from', old.status, 'to', new.status),
        actor,
        actor_name
      );
    end if;

    if new.is_complete is distinct from old.is_complete and new.is_complete then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'marked_complete',
        'Job marked as complete',
        jsonb_build_object('status', new.status),
        actor,
        actor_name
      );
    end if;

    if new.approved_design_images is distinct from old.approved_design_images then
      old_imgs := public.count_design_urls(old.approved_design_images);
      new_imgs := public.count_design_urls(new.approved_design_images);
      added_imgs := greatest(new_imgs - old_imgs, 0);
      if new_imgs > old_imgs then
        insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
        values (
          new.id,
          case
            when old.post_approved_design_review_status = 'needs_changes' then 'design_resubmitted'
            else 'design_images_uploaded'
          end,
          case
            when old.post_approved_design_review_status = 'needs_changes' then
              format('Updated designs uploaded after changes requested (%s new)', added_imgs)
            else
              format('Approved design images uploaded (%s new, %s total)', added_imgs, new_imgs)
          end,
          jsonb_build_object(
            'added', added_imgs,
            'total', new_imgs,
            'previous_review_status', old.post_approved_design_review_status
          ),
          actor,
          actor_name
        );
      elsif new_imgs < old_imgs then
        insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
        values (
          new.id,
          'design_images_updated',
          format('Approved design images updated (%s total)', new_imgs),
          jsonb_build_object('total', new_imgs),
          actor,
          actor_name
        );
      end if;
    end if;

    if new.post_approved_design_review_status is distinct from old.post_approved_design_review_status then
      if new.post_approved_design_review_status = 'approved' then
        insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
        values (
          new.id,
          'design_approved',
          'Approved design marked as approved by sales',
          jsonb_build_object('reviewed_at', new.post_approved_design_reviewed_at),
          actor,
          actor_name
        );
      elsif new.post_approved_design_review_status = 'needs_changes' then
        insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
        values (
          new.id,
          'design_changes_requested',
          coalesce(
            nullif(trim(new.post_approved_design_changes_note), ''),
            'Changes requested (no note provided)'
          ),
          jsonb_build_object('note', new.post_approved_design_changes_note),
          actor,
          actor_name
        );
      elsif new.post_approved_design_review_status = 'pending' then
        insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
        values (
          new.id,
          'design_pending_review',
          'Design awaiting sales review',
          '{}'::jsonb,
          actor,
          actor_name
        );
      end if;
    elsif new.post_approved_design_changes_note is distinct from old.post_approved_design_changes_note
      and coalesce(trim(new.post_approved_design_changes_note), '') <> ''
      and new.post_approved_design_review_status = 'needs_changes' then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'design_changes_note_updated',
        trim(new.post_approved_design_changes_note),
        jsonb_build_object('note', new.post_approved_design_changes_note),
        actor,
        actor_name
      );
    end if;

    if new.remarks is distinct from old.remarks then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'remarks_updated',
        'Remarks updated',
        jsonb_build_object('from', old.remarks, 'to', new.remarks),
        actor,
        actor_name
      );
    end if;

    if new.qty is distinct from old.qty then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'qty_updated',
        format('Quantity updated: %s → %s', old.qty, new.qty),
        jsonb_build_object('from', old.qty, 'to', new.qty),
        actor,
        actor_name
      );
    end if;

    if new.due_date is distinct from old.due_date then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'due_date_updated',
        format('Delivery date updated: %s → %s', old.due_date, new.due_date),
        jsonb_build_object('from', old.due_date, 'to', new.due_date),
        actor,
        actor_name
      );
    end if;

    if new.coordinator_name is distinct from old.coordinator_name then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'coordinator_updated',
        format('Coordinator updated: %s → %s', old.coordinator_name, new.coordinator_name),
        jsonb_build_object('from', old.coordinator_name, 'to', new.coordinator_name),
        actor,
        actor_name
      );
    end if;

    if new.printing_mtrs is distinct from old.printing_mtrs then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'printing_mtrs_updated',
        format('Printing metres updated: %s → %s', old.printing_mtrs, new.printing_mtrs),
        jsonb_build_object('from', old.printing_mtrs, 'to', new.printing_mtrs),
        actor,
        actor_name
      );
    end if;

    if new.received_at_printing is distinct from old.received_at_printing then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'received_at_printing_updated',
        case
          when new.received_at_printing is null then 'Received at printing cleared'
          else format('Received at printing set to %s', to_char(new.received_at_printing at time zone 'UTC', 'YYYY-MM-DD HH24:MI'))
        end,
        jsonb_build_object('from', old.received_at_printing, 'to', new.received_at_printing),
        actor,
        actor_name
      );
    end if;

    return new;
  end if;

  return new;
end;
$$;
