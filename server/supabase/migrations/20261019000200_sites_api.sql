begin;

create index sites_active_name_idx
  on public.sites (name, id) where deactivated_at is null;

-- Persistence results only. The Edge Function assembles public response objects.
create type public.site_area_row as (
  id text, name text, is_public boolean, geometry jsonb
);
create type public.site_species_total_row as (
  species public.species, quantity numeric
);
create type public.site_detail_rows as (
  site public.sites,
  location public.locations,
  total_plants numeric,
  planting_event_count bigint,
  species_totals public.site_species_total_row[],
  areas public.site_area_row[],
  events public.species_event_row[]
);

create function public.site_get(p_id text)
returns setof public.site_detail_rows
language plpgsql stable security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  result public.site_detail_rows;
  stage text := 'read_detail';
  started_at timestamptz := clock_timestamp();
  request_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  log_context jsonb;
  failed_constraint text;
  failed_table text;
  failed_column text;
begin
  log_context := jsonb_build_object(
    'rpc', 'site_get', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'site_id', p_id
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  -- One statement gives all collections and totals the same read snapshot.
  -- Array columns avoid truncation at the Data API's top-level row limit.
  with matching_events as materialized (
    select e.* from public.planting_events e
    where e.site_id = p_id and e.deactivated_at is null
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
  select site, location,
    (select coalesce(sum(q.total_plants), 0) from event_quantities q),
    (select count(*) from matching_events),
    array(
      select row(catalogue, q.quantity)::public.site_species_total_row
      from species_quantities q
      join public.species catalogue on catalogue.id = q.species_id
      order by catalogue.scientific_name, catalogue.id
    ),
    array(
      select row(area.id, area.name, area.is_public, pin.geometry)::public.site_area_row
      from public.planting_areas area
      left join public.locations pin on pin.id = area.location_id and pin.deactivated_at is null
      where area.site_id = site.id and area.deactivated_at is null
      order by area.name, area.id
    ),
    array(
      select row(e.id, site.id, site.name, site.is_public, area.id, area.name,
        e.planting_date, e.event_type, coalesce(q.species_ids, '{}'::text[]),
        q.total_plants, e.is_public, e.season, e.image_url)::public.species_event_row
      from matching_events e
      join event_quantities q on q.id = e.id
      left join public.planting_areas area
        on area.id = e.planting_area_id and area.deactivated_at is null
      order by e.planting_date desc, e.id desc
    )
  into result
  from public.sites site
  left join public.locations location
    on location.id = site.location_id and location.deactivated_at is null
  where site.id = p_id and site.deactivated_at is null;

  if not found then
    raise log '%', log_context || jsonb_build_object(
      'timestamp', clock_timestamp(), 'level', 'info',
      'event', 'database.function.completed', 'stage', stage,
      'outcome', 'not_found',
      'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
    );
    return;
  end if;
  stage := 'check_aggregates';
  -- Reject unsafe numbers before the Data API converts numeric values to JSON.
  if result.total_plants > 9007199254740991
    or result.planting_event_count > 9007199254740991
  then
    raise sqlstate 'PT409' using message = 'Aggregate exceeds the safe integer range.';
  end if;
  return next result;
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.completed', 'stage', stage,
    'outcome', 'success',
    'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
  );
exception when others then
  get stacked diagnostics
    failed_constraint = constraint_name,
    failed_table = table_name,
    failed_column = column_name;
  -- Preserve the original SQLSTATE and rollback; never log supplied values,
  -- exception messages/details or SQL context.
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'error',
    'event', 'database.function.failed', 'stage', stage,
    'database_code', sqlstate,
    'constraint', nullif(failed_constraint, ''), 'table', nullif(failed_table, ''),
    'column', nullif(failed_column, ''),
    'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
  );
  raise;
end;
$$;

create function public.site_create(
  p_id text, p_actor_id text, p_name text, p_description text,
  p_is_public boolean, p_location_id text, p_geometry jsonb
)
returns setof public.site_detail_rows
language plpgsql security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  stage text := 'audit_actor';
  started_at timestamptz := clock_timestamp();
  request_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  log_context jsonb;
  failed_constraint text;
  failed_table text;
  failed_column text;
begin
  log_context := jsonb_build_object(
    'rpc', 'site_create', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'site_id', p_id, 'actor_id', p_actor_id
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  perform 1 from public.users where id = p_actor_id and deactivated_at is null for share;
  if not found then
    raise sqlstate 'PT500' using message = 'Audit actor unavailable.';
  end if;

  -- Both IDs are generated by the server; callers cannot claim another location.
  stage := 'save_location';
  if p_geometry is not null then
    insert into public.locations (id, created_by, updated_by, geometry)
    values (p_location_id, p_actor_id, p_actor_id, p_geometry);
  end if;
  stage := 'save_site';
  insert into public.sites (id, created_by, updated_by, name, description, is_public, location_id)
  values (p_id, p_actor_id, p_actor_id, p_name, p_description, p_is_public,
    case when p_geometry is null then null else p_location_id end);
  stage := 'read_saved_detail';
  return query select * from public.site_get(p_id);
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.completed', 'stage', stage,
    'outcome', 'success',
    'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
  );
exception when others then
  get stacked diagnostics
    failed_constraint = constraint_name,
    failed_table = table_name,
    failed_column = column_name;
  -- Preserve the original SQLSTATE and rollback; never log supplied values,
  -- exception messages/details or SQL context.
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'error',
    'event', 'database.function.failed', 'stage', stage,
    'database_code', sqlstate,
    'constraint', nullif(failed_constraint, ''), 'table', nullif(failed_table, ''),
    'column', nullif(failed_column, ''),
    'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
  );
  raise;
end;
$$;

create function public.site_update(
  p_id text, p_actor_id text, p_name text, p_description text,
  p_is_public boolean, p_location_id text, p_geometry jsonb
)
returns setof public.site_detail_rows
language plpgsql security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  saved public.sites;
  owned_location_id text;
  changed_at timestamptz;
  stage text := 'audit_actor';
  started_at timestamptz := clock_timestamp();
  request_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  log_context jsonb;
  failed_constraint text;
  failed_table text;
  failed_column text;
begin
  log_context := jsonb_build_object(
    'rpc', 'site_update', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'site_id', p_id, 'actor_id', p_actor_id
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  perform 1 from public.users where id = p_actor_id and deactivated_at is null for share;
  if not found then
    raise sqlstate 'PT500' using message = 'Audit actor unavailable.';
  end if;
  stage := 'lock_site';
  select * into saved from public.sites where id = p_id and deactivated_at is null for update;
  if not found then
    raise sqlstate 'PT404' using message = 'Site not found.';
  end if;

  stage := 'lock_location';
  owned_location_id := saved.location_id;
  if owned_location_id is not null then
    perform 1 from public.locations where id = owned_location_id for update;
  end if;
  changed_at := clock_timestamp();
  stage := 'save_location';
  if p_geometry is null then
    update public.locations set deactivated_at = changed_at, updated_at = changed_at, updated_by = p_actor_id
    where id = owned_location_id and deactivated_at is null;
    owned_location_id := null;
  elsif owned_location_id is null then
    owned_location_id := p_location_id;
    insert into public.locations (id, created_by, updated_by, geometry)
    values (owned_location_id, p_actor_id, p_actor_id, p_geometry);
  else
    update public.locations set geometry = p_geometry, updated_at = changed_at, updated_by = p_actor_id
    where id = owned_location_id;
  end if;
  stage := 'save_site';
  update public.sites set name = p_name, description = p_description, is_public = p_is_public,
    location_id = owned_location_id, updated_at = changed_at, updated_by = p_actor_id
  where id = p_id;
  stage := 'read_saved_detail';
  return query select * from public.site_get(p_id);
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.completed', 'stage', stage,
    'outcome', 'success',
    'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
  );
exception when others then
  get stacked diagnostics
    failed_constraint = constraint_name,
    failed_table = table_name,
    failed_column = column_name;
  -- Preserve the original SQLSTATE and rollback; never log supplied values,
  -- exception messages/details or SQL context.
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'error',
    'event', 'database.function.failed', 'stage', stage,
    'database_code', sqlstate,
    'constraint', nullif(failed_constraint, ''), 'table', nullif(failed_table, ''),
    'column', nullif(failed_column, ''),
    'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
  );
  raise;
end;
$$;

create function public.site_deactivate(p_id text, p_actor_id text)
returns void
language plpgsql security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  saved public.sites;
  changed_at timestamptz;
  stage text := 'audit_actor';
  started_at timestamptz := clock_timestamp();
  request_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  log_context jsonb;
  failed_constraint text;
  failed_table text;
  failed_column text;
begin
  log_context := jsonb_build_object(
    'rpc', 'site_deactivate', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'site_id', p_id, 'actor_id', p_actor_id
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  perform 1 from public.users where id = p_actor_id and deactivated_at is null for share;
  if not found then
    raise sqlstate 'PT500' using message = 'Audit actor unavailable.';
  end if;
  stage := 'lock_site';
  select * into saved from public.sites where id = p_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'Site not found.';
  end if;
  if saved.deactivated_at is not null then
    raise log '%', log_context || jsonb_build_object(
      'timestamp', clock_timestamp(), 'level', 'info',
      'event', 'database.function.completed', 'stage', stage,
      'outcome', 'already_inactive',
      'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
    );
    return;
  end if;
  stage := 'lock_location';
  perform 1 from public.locations where id = saved.location_id for update;
  changed_at := clock_timestamp();
  stage := 'deactivate_location';
  update public.locations set deactivated_at = changed_at, updated_at = changed_at, updated_by = p_actor_id
  where id = saved.location_id and deactivated_at is null;
  stage := 'deactivate_site';
  update public.sites set deactivated_at = changed_at, updated_at = changed_at, updated_by = p_actor_id
  where id = p_id;
  -- Keep the location FK and child rows for history. No cascading deactivation.
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.completed', 'stage', stage,
    'outcome', 'success',
    'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
  );
exception when others then
  get stacked diagnostics
    failed_constraint = constraint_name,
    failed_table = table_name,
    failed_column = column_name;
  -- Preserve the original SQLSTATE and rollback; never log supplied values,
  -- exception messages/details or SQL context.
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'error',
    'event', 'database.function.failed', 'stage', stage,
    'database_code', sqlstate,
    'constraint', nullif(failed_constraint, ''), 'table', nullif(failed_table, ''),
    'column', nullif(failed_column, ''),
    'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
  );
  raise;
end;
$$;

revoke all on function public.site_get(text),
  public.site_create(text, text, text, text, boolean, text, jsonb),
  public.site_update(text, text, text, text, boolean, text, jsonb),
  public.site_deactivate(text, text) from public, anon, authenticated;
grant execute on function public.site_get(text),
  public.site_create(text, text, text, text, boolean, text, jsonb),
  public.site_update(text, text, text, text, boolean, text, jsonb),
  public.site_deactivate(text, text) to service_role;
revoke all on type public.site_area_row, public.site_species_total_row, public.site_detail_rows
  from public, anon, authenticated;
grant usage on type public.site_area_row, public.site_species_total_row, public.site_detail_rows
  to service_role;

commit;
