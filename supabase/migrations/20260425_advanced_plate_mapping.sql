begin;

alter table public.products
  add column if not exists plate_count integer,
  add column if not exists plate_unit_price numeric(10,2),
  add column if not exists plate_set_price numeric(10,2),
  add column if not exists plate_names text[] default '{}'::text[],
  add column if not exists plate_images text[] default '{}'::text[],
  add column if not exists plate_map jsonb default '{"version":2,"geometry":"pointy_hex","positions":[],"transforms":[],"mockup":{}}'::jsonb,
  add column if not exists wall_source_image text;

with inferred as (
  select
    id,
    greatest(
      1,
      coalesce(
        plate_count,
        nullif(pieces, 0),
        case
          when jsonb_typeof(panel_map -> 'positions') = 'array'
            then jsonb_array_length(panel_map -> 'positions')
          else null
        end,
        array_length(panel_names, 1),
        array_length(panel_images, 1),
        3
      )
    ) as count_value
  from public.products
)
update public.products p
set
  plate_count = i.count_value,
  plate_set_price = coalesce(p.plate_set_price, p.price, 0),
  plate_unit_price = coalesce(
    p.plate_unit_price,
    round((coalesce(p.price, 0) / nullif(i.count_value, 0))::numeric, 2)
  ),
  plate_names = case
    when p.plate_names is null or cardinality(p.plate_names) = 0
      then coalesce(p.panel_names, '{}'::text[])
    else p.plate_names
  end,
  plate_images = case
    when p.plate_images is null or cardinality(p.plate_images) = 0
      then coalesce(p.panel_images, '{}'::text[])
    else p.plate_images
  end,
  plate_map = case
    when p.plate_map is not null
      and case
        when jsonb_typeof(p.plate_map -> 'positions') = 'array'
          then jsonb_array_length(p.plate_map -> 'positions')
        else 0
      end > 0
      then p.plate_map
    when p.panel_map is not null
      and case
        when jsonb_typeof(p.panel_map -> 'positions') = 'array'
          then jsonb_array_length(p.panel_map -> 'positions')
        else 0
      end > 0
      then jsonb_build_object(
        'version', 2,
        'geometry', 'pointy_hex',
        'positions', p.panel_map -> 'positions',
        'transforms', coalesce(p.panel_map -> 'transforms', '[]'::jsonb),
        'mockup', coalesce(p.panel_map -> 'mockup', '{}'::jsonb)
      )
    else p.plate_map
  end
from inferred i
where p.id = i.id;

update public.products p
set
  plate_map = jsonb_build_object(
    'version', 2,
    'geometry', 'pointy_hex',
    'positions', generated.positions,
    'transforms', '[]'::jsonb,
    'mockup', '{}'::jsonb
  )
from (
  select
    id,
    jsonb_agg(
      jsonb_build_object(
        'row', ((n - 1) / greatest(2, ceil(sqrt(plate_count::numeric))::int))::int,
        'col', ((n - 1) % greatest(2, ceil(sqrt(plate_count::numeric))::int))::int
      )
      order by n
    ) as positions
  from public.products
  cross join lateral generate_series(1, least(coalesce(plate_count, pieces, 3), 24)) as n
  where plate_map is null
     or coalesce(jsonb_typeof(plate_map -> 'positions'), '') <> 'array'
     or case
       when jsonb_typeof(plate_map -> 'positions') = 'array'
         then jsonb_array_length(plate_map -> 'positions')
       else 0
     end = 0
  group by id, plate_count
) generated
where p.id = generated.id;

update public.products
set
  panel_names = coalesce(panel_names, plate_names, '{}'::text[]),
  panel_images = coalesce(panel_images, plate_images, '{}'::text[]),
  panel_map = coalesce(panel_map, plate_map),
  pieces = coalesce(pieces, plate_count);

alter table public.products
  alter column plate_map set default '{"version":2,"geometry":"pointy_hex","positions":[],"transforms":[],"mockup":{}}'::jsonb;

create index if not exists products_plate_count_idx on public.products (plate_count);

commit;
