begin;

create index planting_areas_active_name_idx
  on public.planting_areas (name, id) where deactivated_at is null;

create type public.planting_area_detail_rows as (
  area public.planting_areas,
  site public.sites,
  location public.locations,
  total_plants numeric,
  planting_event_count bigint,
  species_totals public.site_species_total_row[],
  events public.species_event_row[]
);

create function public.planting_area_get(p_id text)
returns setof public.planting_area_detail_rows
language plpgsql stable security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  result public.planting_area_detail_rows;
begin
  -- One statement gives all collections and totals the same read snapshot.
  -- Array columns avoid truncation at the Data API's top-level row limit.
  with matching_events as materialized (
    select e.* from public.planting_events e
    where e.planting_area_id = p_id and e.site_id = (select a.site_id from public.planting_areas a where a.id = p_id) and e.deactivated_at is null
  ), event_quantities as (
    select e.id, coalesce(sum(line.quantity), 0) as total_plants,
      array_agg(line.species_id order by line.species_id)
        filter (where line.quantity > 0 and catalogue.deactivated_at is null) as species_ids
    from matching_events e
    left join public.planting_event_species line
      on line.planting_event_id = e.id and line.deactivated_at is null
    left join public.species catalogue on catalogue.id = line.species_id
    group by e.id
  ), species_quantities as (
    select line.species_id, sum(line.quantity) as quantity
    from matching_events e
    join public.planting_event_species line
      on line.planting_event_id = e.id and line.deactivated_at is null
    group by line.species_id
    having sum(line.quantity) > 0
  )
  select area, site, location,
    (select coalesce(sum(q.total_plants), 0) from event_quantities q),
    (select count(*) from matching_events),
    array(
      select row(catalogue, q.quantity)::public.site_species_total_row
      from species_quantities q
      join public.species catalogue on catalogue.id = q.species_id
      order by catalogue.scientific_name, catalogue.id
    ),
    array(
      select row(e.id, site.id, site.name, site.is_public, area.id, area.name,
        e.planting_date, e.event_type, coalesce(q.species_ids, '{}'::text[]),
        q.total_plants, e.is_public)::public.species_event_row
      from matching_events e
      join event_quantities q on q.id = e.id
      left join public.planting_areas area
        on area.id = e.planting_area_id and area.deactivated_at is null
      order by e.planting_date desc, e.id desc
    )
  into result
  from public.planting_areas area
  join public.sites site on site.id = area.site_id and site.deactivated_at is null
  left join public.locations location
    on location.id = area.location_id and location.deactivated_at is null
  where area.id = p_id and area.deactivated_at is null;

  if not found then return; end if;
  -- Reject unsafe numbers before the Data API converts numeric values to JSON.
  if result.total_plants > 9007199254740991
    or result.planting_event_count > 9007199254740991
  then
    raise sqlstate 'PT409' using message = 'Aggregate exceeds the safe integer range.';
  end if;
  return next result;
end;
$$;

create function public.planting_area_create(
  p_id text, p_actor_id text, p_site_id text, p_name text, p_description text,
  p_is_public boolean, p_location_id text, p_geometry jsonb
)
returns setof public.planting_area_detail_rows
language plpgsql security invoker
set search_path = ''
set timezone = 'UTC'
as $$
begin
  perform 1 from public.users where id = p_actor_id and deactivated_at is null for share;
  if not found then raise sqlstate 'PT500' using message = 'Audit actor unavailable.'; end if;
  -- Parent locks precede area/location locks and prevent racing site deletion.
  perform 1 from public.sites where id = p_site_id and deactivated_at is null for share;
  if not found then raise sqlstate 'PT409' using message = 'Site unavailable.'; end if;

  -- A new supplied location ID must be unused, including historical rows and
  -- locations owned by sites. The primary key arbitrates concurrent claims.
  if p_geometry is not null then
    insert into public.locations (id, created_by, updated_by, geometry)
    values (p_location_id, p_actor_id, p_actor_id, p_geometry);
  end if;
  insert into public.planting_areas
    (id, created_by, updated_by, site_id, name, description, is_public, location_id)
  values (p_id, p_actor_id, p_actor_id, p_site_id, p_name, p_description, p_is_public,
    case when p_geometry is null then null else p_location_id end);
  return query select * from public.planting_area_get(p_id);
end;
$$;

create function public.planting_area_update(
  p_id text, p_actor_id text, p_site_id text, p_name text, p_description text,
  p_is_public boolean, p_location_id text, p_geometry jsonb
)
returns setof public.planting_area_detail_rows
language plpgsql security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  saved public.planting_areas;
  parent_id text;
  changed_at timestamptz;
begin
  perform 1 from public.users where id = p_actor_id and deactivated_at is null for share;
  if not found then raise sqlstate 'PT500' using message = 'Audit actor unavailable.'; end if;
  select site_id into parent_id from public.planting_areas where id = p_id;
  perform 1 from public.sites where id = parent_id and deactivated_at is null for share;
  if not found then raise sqlstate 'PT404' using message = 'Planting area not found.'; end if;
  select * into saved from public.planting_areas where id = p_id and deactivated_at is null for update;
  if not found then raise sqlstate 'PT404' using message = 'Planting area not found.'; end if;
  if p_site_id is distinct from saved.site_id then
    raise sqlstate 'PT409' using message = 'The parent site cannot change.';
  end if;
  perform 1 from public.locations where id = saved.location_id for update;
  changed_at := clock_timestamp();

  if p_geometry is null then
    update public.locations set deactivated_at = changed_at, updated_at = changed_at, updated_by = p_actor_id
    where id = saved.location_id and deactivated_at is null;
  elsif p_location_id = saved.location_id then
    update public.locations set geometry = p_geometry, updated_at = changed_at, updated_by = p_actor_id
    where id = saved.location_id;
  else
    insert into public.locations (id, created_by, updated_by, geometry)
    values (p_location_id, p_actor_id, p_actor_id, p_geometry);
    update public.locations set deactivated_at = changed_at, updated_at = changed_at, updated_by = p_actor_id
    where id = saved.location_id and deactivated_at is null;
  end if;
  update public.planting_areas set name = p_name, description = p_description, is_public = p_is_public,
    location_id = case when p_geometry is null then null else p_location_id end,
    updated_at = changed_at, updated_by = p_actor_id
  where id = p_id;
  return query select * from public.planting_area_get(p_id);
end;
$$;

create function public.planting_area_deactivate(p_id text, p_actor_id text)
returns void
language plpgsql security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  saved public.planting_areas;
  parent_id text;
  changed_at timestamptz;
begin
  perform 1 from public.users where id = p_actor_id and deactivated_at is null for share;
  if not found then raise sqlstate 'PT500' using message = 'Audit actor unavailable.'; end if;
  select site_id into parent_id from public.planting_areas where id = p_id;
  perform 1 from public.sites where id = parent_id and deactivated_at is null for share;
  if not found then raise sqlstate 'PT404' using message = 'Planting area not found.'; end if;
  select * into saved from public.planting_areas where id = p_id for update;
  if not found then raise sqlstate 'PT404' using message = 'Planting area not found.'; end if;
  if saved.deactivated_at is not null then return; end if;
  perform 1 from public.locations where id = saved.location_id for update;
  changed_at := clock_timestamp();
  update public.locations set deactivated_at = changed_at, updated_at = changed_at, updated_by = p_actor_id
  where id = saved.location_id and deactivated_at is null;
  update public.planting_areas set deactivated_at = changed_at, updated_at = changed_at, updated_by = p_actor_id
  where id = p_id;
  -- Retain the location FK and event links for history.
end;
$$;

revoke all on function public.planting_area_get(text),
  public.planting_area_create(text, text, text, text, text, boolean, text, jsonb),
  public.planting_area_update(text, text, text, text, text, boolean, text, jsonb),
  public.planting_area_deactivate(text, text) from public, anon, authenticated;
grant execute on function public.planting_area_get(text),
  public.planting_area_create(text, text, text, text, text, boolean, text, jsonb),
  public.planting_area_update(text, text, text, text, text, boolean, text, jsonb),
  public.planting_area_deactivate(text, text) to service_role;
revoke all on type public.planting_area_detail_rows from public, anon, authenticated;
grant usage on type public.planting_area_detail_rows to service_role;

commit;
