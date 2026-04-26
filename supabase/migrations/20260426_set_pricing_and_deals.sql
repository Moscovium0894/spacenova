-- Rebalance plate set pricing and introduce promotional deals.
-- Pricing rules implemented:
-- 1) Set price is always greater than buying (plate_count - 1) single plates.
-- 2) Set price provides a meaningful discount vs buying all plates individually.
-- 3) Larger sets target more discount, capped by rule (1).

begin;

with counts as (
  select
    id,
    slug,
    greatest(
      1,
      coalesce(
        plate_count,
        case when pieces ~ '^[0-9]+$' then pieces::int end,
        1
      )
    ) as count_value,
    coalesce(plate_unit_price, 34.99)::numeric(10,2) as unit_price
  from public.products
),
pricing as (
  select
    c.id,
    c.slug,
    c.count_value,
    c.unit_price,
    (
      case
        when c.count_value <= 3 then 0.10
        when c.count_value >= 9 then 0.15
        else 0.10 + ((c.count_value - 3) * (0.05 / 6.0))
      end
    )::numeric as target_discount
  from counts c
),
resolved as (
  select
    p.id,
    p.slug,
    p.count_value,
    p.unit_price,
    -- Must stay above (N-1) individual plates, so cap below (1 / N).
    least(
      p.target_discount,
      greatest(0.02, (1.0 / p.count_value) - 0.002)
    )::numeric as applied_discount
  from pricing p
),
final_prices as (
  select
    r.id,
    r.slug,
    r.count_value,
    r.unit_price,
    round((r.count_value * r.unit_price * (1 - r.applied_discount))::numeric, 2) as raw_set_price,
    round((((r.count_value - 1) * r.unit_price) + 0.01)::numeric, 2) as min_valid_set_price
  from resolved r
)
update public.products p
set
  plate_set_price = greatest(fp.raw_set_price, fp.min_valid_set_price),
  price = greatest(fp.raw_set_price, fp.min_valid_set_price),
  price_label =
    'Complete set GBP '
    || greatest(fp.raw_set_price, fp.min_valid_set_price)::text
    || ' / GBP '
    || fp.unit_price::text
    || ' per plate',
  updated_at = now()
from final_prices fp
where p.id = fp.id;

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  subtitle text,
  badge text not null,
  type text not null check (type in ('percent_off', 'fixed_off', 'label')),
  value numeric default 0,
  applies_to text not null default 'all' check (applies_to in ('all', 'product', 'category')),
  product_slug text,
  active boolean not null default true,
  expires_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.deals enable row level security;

drop policy if exists "Public can read active deals" on public.deals;

create policy "Public can read active deals"
  on public.deals for select
  using (active = true);

with ranked as (
  select
    slug,
    coalesce(plate_count, case when pieces ~ '^[0-9]+$' then pieces::int end, 1) as count_value,
    created_at,
    dense_rank() over (order by coalesce(plate_count, case when pieces ~ '^[0-9]+$' then pieces::int end, 1) desc, created_at desc, slug asc) as largest_rank,
    row_number() over (order by created_at desc nulls last, slug asc) as newest_rank
  from public.products
  where coalesce(is_published, true) = true
)
insert into public.deals (slug, title, subtitle, badge, type, value, applies_to, product_slug, active, expires_at, sort_order)
select *
from (
  select
    'largest-set-best-value-' || slug as slug,
    'Best Value' as title,
    'Largest set savings' as subtitle,
    'BEST VALUE' as badge,
    'label'::text as type,
    0::numeric as value,
    'product'::text as applies_to,
    slug as product_slug,
    true as active,
    null::timestamptz as expires_at,
    10 as sort_order
  from ranked
  where largest_rank = 1

  union all

  select
    'six-plate-set-deal-' || slug,
    'Set Deal',
    'Popular six-plate set',
    'SET DEAL',
    'label'::text,
    0::numeric,
    'product'::text,
    slug,
    true,
    null::timestamptz,
    20
  from ranked
  where count_value = 6

  union all

  select
    'new-series-' || slug,
    'New Series',
    'Recently added',
    'JUST ADDED',
    'label'::text,
    0::numeric,
    'product'::text,
    slug,
    true,
    now() + interval '45 days',
    30
  from ranked
  where newest_rank = 1

  union all

  select
    'free-shipping-label',
    'Free Shipping',
    'On qualifying orders',
    'FREE SHIP',
    'label'::text,
    0::numeric,
    'all'::text,
    null::text,
    true,
    null::timestamptz,
    40
) seed
on conflict (slug) do update
set
  title = excluded.title,
  subtitle = excluded.subtitle,
  badge = excluded.badge,
  type = excluded.type,
  value = excluded.value,
  applies_to = excluded.applies_to,
  product_slug = excluded.product_slug,
  active = excluded.active,
  expires_at = excluded.expires_at,
  sort_order = excluded.sort_order;

commit;
