-- Enquiry contact location: city picked from the app list, state derived from it.
-- Staging first (scvojtvgnkmbupvyslmb). Production only on explicit release.

alter table public.enquiries
  add column if not exists customer_city text,
  add column if not exists customer_state text;

comment on column public.enquiries.customer_city is 'Customer city from src/indianCities.js list (New enquiry form).';
comment on column public.enquiries.customer_state is 'State/UT derived from customer_city at save time.';

notify pgrst, 'reload schema';
