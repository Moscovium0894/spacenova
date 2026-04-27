alter table if exists public.products
add column if not exists in_stock boolean not null default true;
