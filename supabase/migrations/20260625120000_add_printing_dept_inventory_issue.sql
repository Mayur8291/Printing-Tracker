-- Printing inventory: track stock usage (issue) as well as refills.

alter table public.printing_dept_refill_log
  add column if not exists movement_type text not null default 'refill'
  check (movement_type in ('refill', 'issue'));

create index if not exists printing_dept_refill_log_movement_created_idx
  on public.printing_dept_refill_log (movement_type, created_at desc);
