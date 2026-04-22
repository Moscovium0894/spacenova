-- Migration: add shipping_type column and enforce ref uniqueness on orders
-- Applied: 2026-04-22

alter table public.orders
  add column if not exists shipping_type text;

-- ref already has a unique column constraint; this index is belt-and-braces
create unique index if not exists orders_ref_unique_idx
  on public.orders (ref);
