-- Tidy product plate data after introducing advanced plate mapping.
-- Goals:
-- - Empty values should be NULL, not [] / {} / ''.
-- - panel_map / plate_map should contain usable positions; [] does not count.
-- - Existing panel_images / panel_names are preserved and mirrored into plate_* columns.
-- - price and plate_set_price are kept aligned, with plate_unit_price standardised to 34.99.

begin;

alter table public.products
  alter column plate_names drop default,
  alter column plate_images drop default,
  alter column plate_map drop default,
  alter column wall_image drop default;

create or replace function pg_temp.sn_plate_positions(count_in integer)
returns jsonb
language sql
immutable
as $$
  with count_value as (
    select greatest(1, least(coalesce(count_in, 1), 24)) as n
  ),
  preset as (
    select case n
      when 1 then '[[0,0]]'::jsonb
      when 2 then '[[0,0],[0,1]]'::jsonb
      when 3 then '[[0,0],[0,1],[1,0]]'::jsonb
      when 4 then '[[0,0],[0,1],[1,0],[1,1]]'::jsonb
      when 5 then '[[0,1],[1,0],[1,1],[1,2],[2,1]]'::jsonb
      when 6 then '[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]]'::jsonb
      when 7 then '[[0,1],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]]'::jsonb
      when 8 then '[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1]]'::jsonb
      when 9 then '[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]]'::jsonb
      when 10 then '[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[1,3],[2,0],[2,1],[2,2]]'::jsonb
      when 11 then '[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[1,3],[2,0],[2,1],[2,2],[2,3]]'::jsonb
      when 12 then '[[0,0],[0,1],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3],[2,0],[2,1],[2,2],[2,3]]'::jsonb
      else null
    end as points, n
    from count_value
  )
  select coalesce(
    (
      select jsonb_agg(jsonb_build_object('row', (value->>0)::int, 'col', (value->>1)::int) order by ord)
      from preset p
      cross join lateral jsonb_array_elements(p.points) with ordinality as e(value, ord)
      where p.points is not null
    ),
    (
      select jsonb_agg(
        jsonb_build_object(
          'row', ((i - 1) / greatest(2, ceil(sqrt(n::numeric))::int))::int,
          'col', ((i - 1) % greatest(2, ceil(sqrt(n::numeric))::int))::int
        )
        order by i
      )
      from preset
      cross join lateral generate_series(1, n) as i
      where points is null
    )
  )
  from preset;
$$;

with counts as (
  select
    id,
    greatest(
      1,
      coalesce(
        case when plate_map is not null and jsonb_typeof(plate_map -> 'positions') = 'array' and jsonb_array_length(plate_map -> 'positions') > 0
          then jsonb_array_length(plate_map -> 'positions') end,
        case when panel_map is not null and jsonb_typeof(panel_map -> 'positions') = 'array' and jsonb_array_length(panel_map -> 'positions') > 0
          then jsonb_array_length(panel_map -> 'positions') end,
        plate_count,
        case when pieces ~ '^[0-9]+$' then pieces::int end,
        cardinality(plate_images),
        case when panel_images is not null and jsonb_typeof(panel_images) = 'array' and jsonb_array_length(panel_images) > 0
          then jsonb_array_length(panel_images) end,
        1
      )
    ) as count_value
  from public.products
),
normalised as (
  select
    p.id,
    c.count_value,
    coalesce(
      case when p.plate_map is not null and jsonb_typeof(p.plate_map -> 'positions') = 'array' and jsonb_array_length(p.plate_map -> 'positions') > 0 then p.plate_map end,
      case when p.panel_map is not null and jsonb_typeof(p.panel_map -> 'positions') = 'array' and jsonb_array_length(p.panel_map -> 'positions') > 0 then p.panel_map end,
      jsonb_build_object('version', 2, 'geometry', 'pointy_hex', 'positions', pg_temp.sn_plate_positions(c.count_value))
    ) as map_value
  from public.products p
  join counts c on c.id = p.id
)
update public.products p
set
  plate_count = n.count_value,
  pieces = n.count_value::text,
  panel_map = jsonb_strip_nulls(jsonb_build_object(
    'version', 2,
    'geometry', 'pointy_hex',
    'positions', n.map_value -> 'positions',
    'transforms', case when jsonb_typeof(n.map_value -> 'transforms') = 'array' and jsonb_array_length(n.map_value -> 'transforms') > 0 then n.map_value -> 'transforms' end,
    'mockup', case when jsonb_typeof(n.map_value -> 'mockup') = 'object' and n.map_value -> 'mockup' <> '{}'::jsonb then n.map_value -> 'mockup' end
  )),
  plate_map = jsonb_strip_nulls(jsonb_build_object(
    'version', 2,
    'geometry', 'pointy_hex',
    'positions', n.map_value -> 'positions',
    'transforms', case when jsonb_typeof(n.map_value -> 'transforms') = 'array' and jsonb_array_length(n.map_value -> 'transforms') > 0 then n.map_value -> 'transforms' end,
    'mockup', case when jsonb_typeof(n.map_value -> 'mockup') = 'object' and n.map_value -> 'mockup' <> '{}'::jsonb then n.map_value -> 'mockup' end
  )),
  plate_unit_price = 34.99,
  plate_set_price = round((n.count_value * 34.99 * 0.90)::numeric, 2),
  price = round((n.count_value * 34.99 * 0.90)::numeric, 2),
  price_label = 'Complete set GBP ' || round((n.count_value * 34.99 * 0.90)::numeric, 2)::text || ' / GBP 34.99 per plate',
  wall_image = nullif(btrim(coalesce(p.wall_image, '')), ''),
  wall_source_image = nullif(btrim(coalesce(p.wall_source_image, '')), ''),
  updated_at = now()
from normalised n
where p.id = n.id;

update public.products p
set
  plate_names = coalesce(
    nullif(plate_names, '{}'::text[]),
    case when panel_names is not null and jsonb_typeof(panel_names) = 'array' and jsonb_array_length(panel_names) > 0
      then array(select jsonb_array_elements_text(panel_names)) end
  ),
  plate_images = coalesce(
    nullif(plate_images, '{}'::text[]),
    case when panel_images is not null and jsonb_typeof(panel_images) = 'array' and jsonb_array_length(panel_images) > 0
      then array(select jsonb_array_elements_text(panel_images)) end
  );

update public.products
set
  plate_names = case when plate_names is null or cardinality(plate_names) = 0 or not exists (select 1 from unnest(plate_names) as value(item) where btrim(value.item) <> '') then null else plate_names end,
  plate_images = case when plate_images is null or cardinality(plate_images) = 0 or not exists (select 1 from unnest(plate_images) as value(item) where btrim(value.item) <> '') then null else plate_images end;

update public.products
set
  panel_names = case when plate_names is null then null else to_jsonb(plate_names) end,
  panel_images = case when plate_images is null then null else to_jsonb(plate_images) end;

commit;
