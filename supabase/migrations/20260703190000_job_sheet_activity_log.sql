-- Job sheet activity: extend order_activity_log trigger for production tracker fields.

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
  archive_grew boolean;
begin
  if actor is not null then
    select coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'User')
    into actor_name
    from public.profiles p
    where p.id = actor;
  end if;

  if TG_OP = 'INSERT' then
    if coalesce(new.is_production_order, false) then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'job_sheet_created',
        format(
          'Job sheet created for %s · Order #%s · Qty %s',
          new.customer_name,
          coalesce(nullif(trim(new.order_id), ''), '—'),
          new.qty
        ),
        jsonb_build_object(
          'status', new.status,
          'order_id', new.order_id,
          'qty', new.qty,
          'size_type', new.size_type,
          'gender', new.gender,
          'product_type', new.product_type,
          'product_name', new.product_name
        ),
        actor,
        actor_name
      );
    else
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
    end if;

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
        case when coalesce(new.is_production_order, false) then 'Job sheet marked as complete' else 'Job marked as complete' end,
        jsonb_build_object('status', new.status),
        actor,
        actor_name
      );
    end if;

    if new.approved_design_images is distinct from old.approved_design_images then
      old_imgs := public.count_design_urls(old.approved_design_images);
      new_imgs := public.count_design_urls(new.approved_design_images);
      added_imgs := greatest(new_imgs - old_imgs, 0);
      archive_grew :=
        public.count_design_urls(new.approved_design_images_archive)
        > public.count_design_urls(old.approved_design_images_archive);

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
      elsif new_imgs < old_imgs and not archive_grew then
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
        coalesce(nullif(trim(new.remarks), ''), 'Remarks cleared'),
        jsonb_build_object('remarks', new.remarks),
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
        format('Delivery date updated: %s → %s', coalesce(old.due_date::text, '—'), coalesce(new.due_date::text, '—')),
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
        jsonb_build_object('received_at_printing', new.received_at_printing),
        actor,
        actor_name
      );
    end if;

    -- Job sheet / production tracker fields
    if new.sales_incharge_name is distinct from old.sales_incharge_name then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'sales_incharge_updated',
        format('Sales incharge updated: %s → %s', coalesce(old.sales_incharge_name, '—'), coalesce(new.sales_incharge_name, '—')),
        jsonb_build_object('from', old.sales_incharge_name, 'to', new.sales_incharge_name),
        actor,
        actor_name
      );
    end if;

    if new.product_name is distinct from old.product_name then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'product_name_updated',
        format('Product name updated: %s → %s', coalesce(old.product_name, '—'), coalesce(new.product_name, '—')),
        jsonb_build_object('from', old.product_name, 'to', new.product_name),
        actor,
        actor_name
      );
    end if;

    if new.colors is distinct from old.colors then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'colors_updated',
        format('Colors updated: %s → %s', coalesce(array_to_string(old.colors, ', '), '—'), coalesce(array_to_string(new.colors, ', '), '—')),
        jsonb_build_object('from', old.colors, 'to', new.colors),
        actor,
        actor_name
      );
    end if;

    if new.size_type is distinct from old.size_type then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'size_type_updated',
        format('Size type updated: %s → %s', coalesce(old.size_type, '—'), coalesce(new.size_type, '—')),
        jsonb_build_object('from', old.size_type, 'to', new.size_type),
        actor,
        actor_name
      );
    end if;

    if new.gender is distinct from old.gender then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'gender_updated',
        format('Gender updated: %s → %s', coalesce(old.gender, '—'), coalesce(new.gender, '—')),
        jsonb_build_object('from', old.gender, 'to', new.gender),
        actor,
        actor_name
      );
    end if;

    if new.product_type is distinct from old.product_type then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'product_type_updated',
        format('Product type updated: %s → %s', coalesce(old.product_type, '—'), coalesce(new.product_type, '—')),
        jsonb_build_object('from', old.product_type, 'to', new.product_type),
        actor,
        actor_name
      );
    end if;

    if new.rate_per_piece is distinct from old.rate_per_piece then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'rate_per_piece_updated',
        format('Rate per piece updated: %s → %s', coalesce(old.rate_per_piece::text, '—'), coalesce(new.rate_per_piece::text, '—')),
        jsonb_build_object('from', old.rate_per_piece, 'to', new.rate_per_piece),
        actor,
        actor_name
      );
    end if;

    if new.size_breakdown is distinct from old.size_breakdown then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'size_breakdown_updated',
        'Size breakdown updated',
        jsonb_build_object('from', old.size_breakdown, 'to', new.size_breakdown),
        actor,
        actor_name
      );
    end if;

    if new.brand is distinct from old.brand then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'brand_updated',
        format('Brand updated: %s → %s', coalesce(old.brand, '—'), coalesce(new.brand, '—')),
        jsonb_build_object('from', old.brand, 'to', new.brand),
        actor,
        actor_name
      );
    end if;

    if new.fabric_type is distinct from old.fabric_type then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'fabric_type_updated',
        format('Fabric type updated: %s → %s', coalesce(old.fabric_type, '—'), coalesce(new.fabric_type, '—')),
        jsonb_build_object('from', old.fabric_type, 'to', new.fabric_type),
        actor,
        actor_name
      );
    end if;

    if new.gsm is distinct from old.gsm then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'gsm_updated',
        format('GSM updated: %s → %s', coalesce(old.gsm, '—'), coalesce(new.gsm, '—')),
        jsonb_build_object('from', old.gsm, 'to', new.gsm),
        actor,
        actor_name
      );
    end if;

    if new.branding is distinct from old.branding or new.branding_type is distinct from old.branding_type then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'branding_updated',
        format(
          'Branding updated: %s → %s%s',
          case when coalesce(old.branding, false) then 'Yes' else 'No' end,
          case when coalesce(new.branding, false) then 'Yes' else 'No' end,
          case when coalesce(new.branding, false) and coalesce(new.branding_type, '') <> '' then ' · ' || new.branding_type else '' end
        ),
        jsonb_build_object(
          'from_branding', old.branding,
          'to_branding', new.branding,
          'from_type', old.branding_type,
          'to_type', new.branding_type
        ),
        actor,
        actor_name
      );
    end if;

    if new.atta is distinct from old.atta then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'atta_updated',
        format(
          'Atta updated: %s → %s',
          case when coalesce(old.atta, false) then 'Yes' else 'No' end,
          case when coalesce(new.atta, false) then 'Yes' else 'No' end
        ),
        jsonb_build_object('from', old.atta, 'to', new.atta),
        actor,
        actor_name
      );
    end if;

    if new.expected_handover_to_printing is distinct from old.expected_handover_to_printing then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'expected_handover_updated',
        format(
          'Handover to printing updated: %s → %s',
          coalesce(old.expected_handover_to_printing::text, '—'),
          coalesce(new.expected_handover_to_printing::text, '—')
        ),
        jsonb_build_object('from', old.expected_handover_to_printing, 'to', new.expected_handover_to_printing),
        actor,
        actor_name
      );
    end if;

    if (
      new.job_sheet_payment_mode is distinct from old.job_sheet_payment_mode
      or new.job_sheet_advance_amount is distinct from old.job_sheet_advance_amount
      or new.job_sheet_advance_payment_date is distinct from old.job_sheet_advance_payment_date
      or new.job_sheet_balance_amount is distinct from old.job_sheet_balance_amount
      or new.job_sheet_pending_amount is distinct from old.job_sheet_pending_amount
      or new.job_sheet_full_paid is distinct from old.job_sheet_full_paid
      or new.job_sheet_payment_closure_at is distinct from old.job_sheet_payment_closure_at
    ) then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'job_sheet_payment_updated',
        format(
          'Payment updated · Mode: %s · Advance: %s · Full paid: %s',
          coalesce(new.job_sheet_payment_mode, '—'),
          coalesce(new.job_sheet_advance_amount::text, '—'),
          case when coalesce(new.job_sheet_full_paid, false) then 'Yes' else 'No' end
        ),
        jsonb_build_object(
          'payment_mode', new.job_sheet_payment_mode,
          'advance_amount', new.job_sheet_advance_amount,
          'advance_payment_date', new.job_sheet_advance_payment_date,
          'balance_amount', new.job_sheet_balance_amount,
          'pending_amount', new.job_sheet_pending_amount,
          'full_paid', new.job_sheet_full_paid,
          'payment_closure_at', new.job_sheet_payment_closure_at
        ),
        actor,
        actor_name
      );
    end if;

    if new.job_sheet_advance_proof_url is distinct from old.job_sheet_advance_proof_url
      and coalesce(trim(new.job_sheet_advance_proof_url), '') <> '' then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'job_sheet_advance_proof_uploaded',
        'Advance payment proof uploaded',
        jsonb_build_object('has_proof', true),
        actor,
        actor_name
      );
    end if;

    if new.job_sheet_payment_proof_url is distinct from old.job_sheet_payment_proof_url
      and coalesce(trim(new.job_sheet_payment_proof_url), '') <> '' then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'job_sheet_payment_proof_uploaded',
        'Full payment proof uploaded',
        jsonb_build_object('has_proof', true),
        actor,
        actor_name
      );
    end if;

    if (
      new.job_sheet_delivery_city is distinct from old.job_sheet_delivery_city
      or new.job_sheet_transport_charges is distinct from old.job_sheet_transport_charges
    ) then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'job_sheet_delivery_updated',
        format(
          'Delivery updated · City: %s · Transport: %s',
          coalesce(new.job_sheet_delivery_city, '—'),
          coalesce(new.job_sheet_transport_charges::text, '—')
        ),
        jsonb_build_object(
          'delivery_city', new.job_sheet_delivery_city,
          'transport_charges', new.job_sheet_transport_charges
        ),
        actor,
        actor_name
      );
    end if;

    if (
      new.job_sheet_approval_date is distinct from old.job_sheet_approval_date
      or new.job_sheet_approved_by is distinct from old.job_sheet_approved_by
      or (
        new.job_sheet_approval_image_url is distinct from old.job_sheet_approval_image_url
        and coalesce(trim(new.job_sheet_approval_image_url), '') <> ''
      )
    ) then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'job_sheet_approval_updated',
        format(
          'Approval updated · Date: %s · By: %s',
          coalesce(new.job_sheet_approval_date::text, '—'),
          coalesce(new.job_sheet_approved_by, '—')
        ),
        jsonb_build_object(
          'approval_date', new.job_sheet_approval_date,
          'approved_by', new.job_sheet_approved_by,
          'has_image', coalesce(trim(new.job_sheet_approval_image_url), '') <> ''
        ),
        actor,
        actor_name
      );
    end if;

    if (
      new.job_sheet_regular_stock is distinct from old.job_sheet_regular_stock
      or new.job_sheet_regular_stock_items is distinct from old.job_sheet_regular_stock_items
    ) then
      insert into public.order_activity_log (order_id, event_type, message, meta, actor_id, actor_label)
      values (
        new.id,
        'job_sheet_regular_stock_updated',
        format(
          'Regular stock updated · %s · %s item(s)',
          case when coalesce(new.job_sheet_regular_stock, false) then 'Yes' else 'No' end,
          coalesce(jsonb_array_length(new.job_sheet_regular_stock_items), 0)
        ),
        jsonb_build_object(
          'regular_stock', new.job_sheet_regular_stock,
          'items', new.job_sheet_regular_stock_items
        ),
        actor,
        actor_name
      );
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_order_activity on public.orders;
create trigger trg_log_order_activity
after insert or update on public.orders
for each row execute procedure public.log_order_activity();
