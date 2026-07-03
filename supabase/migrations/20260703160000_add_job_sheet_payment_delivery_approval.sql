-- Job sheet: payment, delivery city, transport, and approval fields

alter table public.orders add column if not exists job_sheet_payment_mode text;
alter table public.orders add column if not exists job_sheet_advance_amount numeric(12, 2) check (job_sheet_advance_amount is null or job_sheet_advance_amount >= 0);
alter table public.orders add column if not exists job_sheet_advance_payment_date date;
alter table public.orders add column if not exists job_sheet_advance_proof_url text;
alter table public.orders add column if not exists job_sheet_balance_amount numeric(12, 2) check (job_sheet_balance_amount is null or job_sheet_balance_amount >= 0);
alter table public.orders add column if not exists job_sheet_pending_amount numeric(12, 2) check (job_sheet_pending_amount is null or job_sheet_pending_amount >= 0);
alter table public.orders add column if not exists job_sheet_full_paid boolean not null default false;
alter table public.orders add column if not exists job_sheet_payment_closure_at timestamptz;
alter table public.orders add column if not exists job_sheet_payment_proof_url text;
alter table public.orders add column if not exists job_sheet_delivery_city text;
alter table public.orders add column if not exists job_sheet_transport_charges numeric(12, 2) check (job_sheet_transport_charges is null or job_sheet_transport_charges >= 0);
alter table public.orders add column if not exists job_sheet_approval_date date;
alter table public.orders add column if not exists job_sheet_approval_image_url text;
alter table public.orders add column if not exists job_sheet_approved_by text;
