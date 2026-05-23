-- Replace payment method options; map legacy values for existing rows.
-- Bypass order RLS trigger during migration (no auth user during db push).

alter table public.orders disable trigger trg_enforce_order_update_scope;

-- Drop old allowed-values list before writing new payment_method values.
alter table public.orders drop constraint if exists orders_payment_method_check;

update public.orders
set payment_method = 'paid'
where payment_method in ('paid_online', 'paid_non_gst', 'paid_with_invoice');

update public.orders
set payment_method = 'pi_sent_pending_payment'
where payment_method in ('payment_pending', 'partial_paid');

alter table public.orders add constraint orders_payment_method_check
check (
  payment_method is null
  or payment_method in (
    'paid',
    'pi_sent_advance_received',
    'pi_sent_pending_payment'
  )
);

alter table public.orders enable trigger trg_enforce_order_update_scope;

comment on column public.orders.payment_screenshot_url is
  'Payment proof when payment_method is paid or pi_sent_advance_received.';
