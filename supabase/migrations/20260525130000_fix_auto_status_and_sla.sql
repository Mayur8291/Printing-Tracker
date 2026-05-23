-- Fix 12h new→pending auto-promote (SLA whitelist) + RPC for reliable client promotion.

create or replace function public.promote_stale_new_orders_to_pending()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  promoted_count integer;
begin
  update public.orders
  set status = 'pending'
  where status = 'new'
    and not is_complete
    and created_at <= (now() - interval '12 hours');

  get diagnostics promoted_count = row_count;
  return promoted_count;
end;
$$;

revoke all on function public.promote_stale_new_orders_to_pending() from public;
grant execute on function public.promote_stale_new_orders_to_pending() to authenticated;

create or replace function public.enforce_order_update_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  actor_department text;
  allow_create boolean := false;
  allow_status boolean := false;
  allow_remarks boolean := false;
  allow_due_date boolean := false;
  allow_qty boolean := false;
  allow_coordinator_name boolean := false;
  allow_printing_mtrs boolean := false;
  allow_approved_design_images boolean := true;
  allow_received_at_printing boolean := false;
  allow_sales_review boolean := false;
  has_field_edit boolean := false;
  review_fields_changed boolean := false;
  images_changed boolean := false;
begin
  select role, coalesce(department, '') into actor_role, actor_department
  from public.profiles
  where id = auth.uid();

  allow_sales_review := actor_department ilike '%sales%';

  if actor_role = 'admin' then
    return new;
  end if;

  if actor_role = 'viewer' then
    select
      coalesce(pop.can_create_orders, false),
      coalesce(pop.can_edit_status, true),
      coalesce(pop.can_edit_remarks, false),
      coalesce(pop.can_edit_due_date, false),
      coalesce(pop.can_edit_qty, false),
      coalesce(pop.can_edit_coordinator_name, false),
      coalesce(pop.can_edit_printing_mtrs, false),
      coalesce(pop.can_edit_approved_design_images, true),
      coalesce(pop.can_edit_received_at_printing, false)
    into allow_create, allow_status, allow_remarks, allow_due_date, allow_qty, allow_coordinator_name, allow_printing_mtrs, allow_approved_design_images, allow_received_at_printing
    from public.profile_order_permissions pop
    where pop.user_id = auth.uid();

    if not found then
      allow_create := false;
      allow_status := true;
      allow_remarks := false;
      allow_due_date := false;
      allow_qty := false;
      allow_coordinator_name := false;
      allow_printing_mtrs := false;
      allow_approved_design_images := true;
      allow_received_at_printing := false;
    end if;

    images_changed := new.approved_design_images is distinct from old.approved_design_images;
    review_fields_changed :=
      new.post_approved_design_review_status is distinct from old.post_approved_design_review_status
      or new.post_approved_design_changes_note is distinct from old.post_approved_design_changes_note
      or new.post_approved_design_reviewed_by is distinct from old.post_approved_design_reviewed_by
      or new.post_approved_design_reviewed_at is distinct from old.post_approved_design_reviewed_at;

    if images_changed then
      if not allow_approved_design_images then
        raise exception 'Viewer cannot edit approved design images';
      end if;
      return new;
    end if;

    -- SLA: new → pending after 12h (status-only update).
    if old.status = 'new'
       and new.status = 'pending'
       and not old.is_complete
       and not new.is_complete
       and old.created_at <= (now() - interval '12 hours')
       and new.id is not distinct from old.id
       and new.order_date is not distinct from old.order_date
       and new.order_id is not distinct from old.order_id
       and new.owner_name is not distinct from old.owner_name
       and new.customer_name is not distinct from old.customer_name
       and new.coordinator_name is not distinct from old.coordinator_name
       and new.qty is not distinct from old.qty
       and new.size_breakdown is not distinct from old.size_breakdown
       and new.product_name is not distinct from old.product_name
       and new.colors is not distinct from old.colors
       and new.approved_design_url is not distinct from old.approved_design_url
       and new.approved_design_images is not distinct from old.approved_design_images
       and new.approved_design_images_archive is not distinct from old.approved_design_images_archive
       and new.post_approved_design_review_status is not distinct from old.post_approved_design_review_status
       and new.post_approved_design_changes_note is not distinct from old.post_approved_design_changes_note
       and new.post_approved_design_reviewed_by is not distinct from old.post_approved_design_reviewed_by
       and new.post_approved_design_reviewed_at is not distinct from old.post_approved_design_reviewed_at
       and new.due_date is not distinct from old.due_date
       and new.printing_mtrs is not distinct from old.printing_mtrs
       and new.remarks is not distinct from old.remarks
       and new.payment_method is not distinct from old.payment_method
       and new.delivery_method is not distinct from old.delivery_method
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at
       and new.is_live is not distinct from old.is_live
       and new.is_production_order is not distinct from old.is_production_order
       and new.expected_handover_to_printing is not distinct from old.expected_handover_to_printing
       and new.received_at_printing is not distinct from old.received_at_printing
       and new.status_ready_at is not distinct from old.status_ready_at
    then
      return new;
    end if;

    has_field_edit :=
      allow_status
      or allow_remarks
      or allow_due_date
      or allow_qty
      or allow_coordinator_name
      or allow_printing_mtrs
      or allow_approved_design_images
      or allow_received_at_printing
      or (allow_sales_review and review_fields_changed);

    if old.created_by is not distinct from auth.uid()
      and allow_create
      and not has_field_edit
      and (
        new.status is distinct from old.status
        or new.remarks is distinct from old.remarks
        or new.due_date is distinct from old.due_date
        or new.qty is distinct from old.qty
        or new.coordinator_name is distinct from old.coordinator_name
        or new.printing_mtrs is distinct from old.printing_mtrs
        or new.approved_design_images is distinct from old.approved_design_images
        or new.post_approved_design_review_status is distinct from old.post_approved_design_review_status
        or new.post_approved_design_changes_note is distinct from old.post_approved_design_changes_note
        or new.post_approved_design_reviewed_by is distinct from old.post_approved_design_reviewed_by
        or new.post_approved_design_reviewed_at is distinct from old.post_approved_design_reviewed_at
        or new.received_at_printing is distinct from old.received_at_printing
      ) then
      raise exception 'Orders you created cannot be edited after saving. Ask an admin to grant field access if you need to update this job.';
    end if;

    if new.order_date is distinct from old.order_date
      or new.owner_name is distinct from old.owner_name
      or new.customer_name is distinct from old.customer_name
      or new.product_name is distinct from old.product_name
      or new.colors is distinct from old.colors
      or new.approved_design_url is distinct from old.approved_design_url
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.is_live is distinct from old.is_live
      or new.is_complete is distinct from old.is_complete then
      raise exception 'Viewer is not allowed to edit those fields';
    end if;

    if review_fields_changed and not allow_sales_review then
      raise exception 'Only sales department users can approve or request design changes';
    end if;

    if not allow_printing_mtrs and new.printing_mtrs is distinct from old.printing_mtrs then
      raise exception 'Viewer cannot edit printing mtrs';
    end if;

    if not allow_status and new.status is distinct from old.status then
      raise exception 'Viewer cannot edit status';
    end if;
    if not allow_remarks and new.remarks is distinct from old.remarks then
      raise exception 'Viewer cannot edit remarks';
    end if;
    if not allow_due_date and new.due_date is distinct from old.due_date then
      raise exception 'Viewer cannot edit due date';
    end if;
    if not allow_qty and new.qty is distinct from old.qty then
      raise exception 'Viewer cannot edit qty';
    end if;
    if not allow_coordinator_name and new.coordinator_name is distinct from old.coordinator_name then
      raise exception 'Viewer cannot edit coordinator';
    end if;
    if not allow_received_at_printing and new.received_at_printing is distinct from old.received_at_printing then
      raise exception 'Viewer cannot edit received date/time to printing';
    end if;
    return new;
  end if;

  raise exception 'No valid role for order update';
end;
$$;
