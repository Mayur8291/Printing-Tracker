-- Dispatch tab: piece-count / product / color verification at handover.

alter table public.orders add column if not exists dispatch_sizes_qty_ok boolean;
alter table public.orders add column if not exists dispatch_product_name_ok boolean;
alter table public.orders add column if not exists dispatch_colors_ok boolean;
alter table public.orders add column if not exists dispatch_issue_type text;
alter table public.orders add column if not exists dispatch_verification_failed boolean not null default false;
alter table public.orders add column if not exists dispatch_verified_at timestamptz;
alter table public.orders add column if not exists dispatch_verified_by uuid references auth.users(id);

alter table public.orders drop constraint if exists orders_dispatch_issue_type_check;
alter table public.orders add constraint orders_dispatch_issue_type_check
check (
  dispatch_issue_type is null
  or dispatch_issue_type in ('count_mismatch', 'product_mismatch', 'color_mismatch')
);

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
  allow_payment_method boolean := false;
  allow_sales_review boolean := false;
  has_field_edit boolean := false;
  review_fields_changed boolean := false;
  images_changed boolean := false;
  dispatch_fields_changed boolean := false;
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
      coalesce(pop.can_edit_received_at_printing, false),
      coalesce(pop.can_edit_payment_method, false)
    into allow_create, allow_status, allow_remarks, allow_due_date, allow_qty, allow_coordinator_name, allow_printing_mtrs, allow_approved_design_images, allow_received_at_printing, allow_payment_method
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
      allow_payment_method := false;
    end if;

    images_changed := new.approved_design_images is distinct from old.approved_design_images;
    review_fields_changed :=
      new.post_approved_design_review_status is distinct from old.post_approved_design_review_status
      or new.post_approved_design_changes_note is distinct from old.post_approved_design_changes_note
      or new.post_approved_design_reviewed_by is distinct from old.post_approved_design_reviewed_by
      or new.post_approved_design_reviewed_at is distinct from old.post_approved_design_reviewed_at;

    dispatch_fields_changed :=
      new.dispatch_sizes_qty_ok is distinct from old.dispatch_sizes_qty_ok
      or new.dispatch_product_name_ok is distinct from old.dispatch_product_name_ok
      or new.dispatch_colors_ok is distinct from old.dispatch_colors_ok
      or new.dispatch_issue_type is distinct from old.dispatch_issue_type
      or new.dispatch_verification_failed is distinct from old.dispatch_verification_failed
      or new.dispatch_verified_at is distinct from old.dispatch_verified_at
      or new.dispatch_verified_by is distinct from old.dispatch_verified_by;

    if images_changed then
      if not allow_approved_design_images then
        raise exception 'Viewer cannot edit approved design images';
      end if;
      return new;
    end if;

    -- Dispatch tab: verification fields only.
    if dispatch_fields_changed
       and new.id is not distinct from old.id
       and new.status is not distinct from old.status
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
       and new.payment_screenshot_url is not distinct from old.payment_screenshot_url
       and new.invoice_url is not distinct from old.invoice_url
       and new.delivery_method is not distinct from old.delivery_method
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at
       and new.is_live is not distinct from old.is_live
       and new.is_complete is not distinct from old.is_complete
       and new.is_production_order is not distinct from old.is_production_order
       and new.expected_handover_to_printing is not distinct from old.expected_handover_to_printing
       and new.received_at_printing is not distinct from old.received_at_printing
       and new.status_ready_at is not distinct from old.status_ready_at
    then
      return new;
    end if;

    -- Billing: invoice upload only (any workflow status).
    if new.invoice_url is distinct from old.invoice_url
       and new.id is not distinct from old.id
       and new.status is not distinct from old.status
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
       and new.payment_screenshot_url is not distinct from old.payment_screenshot_url
       and new.delivery_method is not distinct from old.delivery_method
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at
       and new.is_live is not distinct from old.is_live
       and new.is_complete is not distinct from old.is_complete
       and new.is_production_order is not distinct from old.is_production_order
       and new.expected_handover_to_printing is not distinct from old.expected_handover_to_printing
       and new.received_at_printing is not distinct from old.received_at_printing
       and new.status_ready_at is not distinct from old.status_ready_at
       and new.dispatch_sizes_qty_ok is not distinct from old.dispatch_sizes_qty_ok
       and new.dispatch_product_name_ok is not distinct from old.dispatch_product_name_ok
       and new.dispatch_colors_ok is not distinct from old.dispatch_colors_ok
       and new.dispatch_issue_type is not distinct from old.dispatch_issue_type
       and new.dispatch_verification_failed is not distinct from old.dispatch_verification_failed
       and new.dispatch_verified_at is not distinct from old.dispatch_verified_at
       and new.dispatch_verified_by is not distinct from old.dispatch_verified_by
    then
      return new;
    end if;

    -- SLA auto-step: new -> pending after 12h, or 10min when delivery is same/next day as order date.
    if old.status = 'new'
       and new.status = 'pending'
       and not old.is_complete
       and not new.is_complete
       and (
         old.created_at <= (now() - interval '12 hours')
         or (
           old.created_at <= (now() - interval '10 minutes')
           and public.order_has_urgent_delivery_window(old.order_date, old.due_date)
         )
       )
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
       and new.invoice_url is not distinct from old.invoice_url
       and new.dispatch_sizes_qty_ok is not distinct from old.dispatch_sizes_qty_ok
       and new.dispatch_product_name_ok is not distinct from old.dispatch_product_name_ok
       and new.dispatch_colors_ok is not distinct from old.dispatch_colors_ok
       and new.dispatch_issue_type is not distinct from old.dispatch_issue_type
       and new.dispatch_verification_failed is not distinct from old.dispatch_verification_failed
       and new.dispatch_verified_at is not distinct from old.dispatch_verified_at
       and new.dispatch_verified_by is not distinct from old.dispatch_verified_by
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
      or allow_payment_method
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
        or new.payment_method is distinct from old.payment_method
        or new.payment_screenshot_url is distinct from old.payment_screenshot_url
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
    if not allow_payment_method and new.payment_method is distinct from old.payment_method then
      raise exception 'Viewer cannot edit payment method';
    end if;
    if not allow_payment_method and new.payment_screenshot_url is distinct from old.payment_screenshot_url then
      raise exception 'Viewer cannot edit payment proof';
    end if;
    return new;
  end if;

  raise exception 'No valid role for order update';
end;
$$;
