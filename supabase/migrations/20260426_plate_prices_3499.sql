-- Standardise individual plate pricing and give complete sets a small bundle incentive.
-- This keeps each individual plate at GBP 34.99 and makes the complete set 10% cheaper
-- than buying every plate separately.

alter table public.products
  add column if not exists plate_count integer,
  add column if not exists plate_unit_price numeric(10,2),
  add column if not exists plate_set_price numeric(10,2),
  add column if not exists panel_map jsonb,
  add column if not exists updated_at timestamp with time zone default now();

with product_counts as (
  select
    slug,
    greatest(
      1,
      coalesce(
        plate_count,
        case
          when pieces::text ~ '^[0-9]+$' then pieces::int
          else null
        end,
        case
          when panel_map is not null
           and jsonb_typeof(panel_map -> 'positions') = 'array'
            then jsonb_array_length(panel_map -> 'positions')
          else null
        end,
        1
      )
    ) as count
  from public.products
)
update public.products p
set
  plate_unit_price = 34.99,
  plate_set_price = round((pc.count * 34.99 * 0.90)::numeric, 2),
  price = round((pc.count * 34.99 * 0.90)::numeric, 2),
  price_label = 'Complete set GBP ' || round((pc.count * 34.99 * 0.90)::numeric, 2)::text || ' / GBP 34.99 per plate',
  updated_at = now()
from product_counts pc
where p.slug = pc.slug;
