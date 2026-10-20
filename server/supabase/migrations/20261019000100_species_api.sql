begin;

-- Per-schema defaults cannot remove PostgreSQL's global PUBLIC EXECUTE grant.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated, service_role;

revoke all privileges on table
  public.users, public.locations, public.sites, public.planting_areas,
  public.species, public.planting_events, public.planting_event_species
from service_role;
grant select, insert, update on table
  public.users, public.locations, public.sites, public.planting_areas,
  public.species, public.planting_events, public.planting_event_species
to service_role;

create index species_active_name_idx
  on public.species (scientific_name, id) where deactivated_at is null;

-- Flat query results, not public HTTP contracts. TypeScript assembles the DTOs.
create type public.species_event_row as (
  id text,
  site_id text,
  site_name text,
  site_is_public boolean,
  planting_area_id text,
  planting_area_name text,
  planting_date date,
  event_type text,
  species_ids text[],
  total_plants numeric,
  is_public boolean,
  season text,
  image_url text
);

create type public.species_detail_rows as (
  species public.species,
  total_plants numeric,
  planting_event_count bigint,
  events public.species_event_row[]
);

create function public.species_get(p_id text)
returns setof public.species_detail_rows
language plpgsql
stable
security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  result public.species_detail_rows;
  stage text := 'read_detail';
  started_at timestamptz := clock_timestamp();
  request_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  log_context jsonb;
  failed_constraint text;
  failed_table text;
  failed_column text;
begin
  log_context := jsonb_build_object(
    'rpc', 'species_get', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'species_id', p_id
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  -- One statement keeps the saved row, history and aggregates in one snapshot.
  -- An array column keeps complete history outside the Data API's row cap.
  with matching_events as materialized (
    select e.*, line.quantity as species_quantity,
      site.name as site_name, site.is_public as site_is_public
    from public.planting_events e
    join public.sites site on site.id = e.site_id and site.deactivated_at is null
    join public.planting_event_species line
      on line.planting_event_id = e.id
      and line.species_id = p_id
      and line.deactivated_at is null
      and line.quantity > 0
    where e.deactivated_at is null
  ), event_quantities as (
    select e.id, sum(line.quantity) as total_plants,
      array_agg(line.species_id order by line.species_id)
        filter (where line.quantity > 0 and catalogue.deactivated_at is null) as species_ids
    from matching_events e
    join public.planting_event_species line
      on line.planting_event_id = e.id and line.deactivated_at is null
    join public.species catalogue on catalogue.id = line.species_id
    group by e.id
  )
  select s, (select coalesce(sum(e.species_quantity), 0) from matching_events e),
    (select count(*) from matching_events),
    array(
      select row(e.id, e.site_id, e.site_name, e.site_is_public, area.id, area.name,
        e.planting_date, e.event_type, coalesce(q.species_ids, '{}'::text[]),
        q.total_plants, e.is_public, e.season, e.image_url)::public.species_event_row
      from matching_events e
      join event_quantities q on q.id = e.id
      left join public.planting_areas area
        on area.id = e.planting_area_id and area.deactivated_at is null
      order by e.planting_date desc, e.id desc
    )
  into result
  from public.species s
  where s.id = p_id and s.deactivated_at is null;

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
  -- Reject before numeric values reach JavaScript; a failed save rolls back too.
  if result.total_plants > 9007199254740991
    or result.planting_event_count > 9007199254740991
    or exists (select 1 from unnest(result.events) e where e.total_plants > 9007199254740991)
  then
    raise exception using errcode = 'PT409', message = 'Planting total exceeds the supported integer range.';
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

create function public.species_create(
  p_actor_id text, p_id text, p_scientific_name text, p_common_name text,
  p_aliases text[], p_description text, p_image_url text, p_is_public boolean
)
returns setof public.species_detail_rows
language plpgsql
security invoker
set search_path = ''
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
    'rpc', 'species_create', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'species_id', p_id, 'actor_id', p_actor_id
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  -- The fixed development actor is replaced by a verified actor when auth arrives.
  -- SHARE permits concurrent saves but prevents actor deactivation during a save.
  perform 1 from public.users where id = p_actor_id and deactivated_at is null for share;
  if not found then
    raise exception using errcode = 'PT500', message = 'Development audit user is missing or inactive.';
  end if;

  stage := 'save_species';
  insert into public.species (
    id, scientific_name, common_name, aliases, description, image_url, is_public,
    created_by, updated_by
  ) values (
    p_id, p_scientific_name, p_common_name, p_aliases, p_description, p_image_url, p_is_public,
    p_actor_id, p_actor_id
  );
  stage := 'read_saved_detail';
  return query select * from public.species_get(p_id);
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

create function public.species_update(
  p_actor_id text, p_id text, p_scientific_name text, p_common_name text,
  p_aliases text[], p_description text, p_image_url text, p_is_public boolean
)
returns setof public.species_detail_rows
language plpgsql
security invoker
set search_path = ''
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
    'rpc', 'species_update', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'species_id', p_id, 'actor_id', p_actor_id
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  perform 1 from public.users where id = p_actor_id and deactivated_at is null for share;
  if not found then
    raise exception using errcode = 'PT500', message = 'Development audit user is missing or inactive.';
  end if;
  stage := 'lock_species';
  perform 1 from public.species where id = p_id and deactivated_at is null for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Species not found.';
  end if;

  stage := 'save_species';
  update public.species set
    scientific_name = p_scientific_name, common_name = p_common_name,
    aliases = p_aliases, description = p_description, image_url = p_image_url,
    is_public = p_is_public, updated_by = p_actor_id, updated_at = clock_timestamp()
  where id = p_id;
  stage := 'read_saved_detail';
  return query select * from public.species_get(p_id);
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

create function public.species_deactivate(p_actor_id text, p_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  original_deactivated_at timestamptz;
  mutation_time timestamptz;
  stage text := 'audit_actor';
  started_at timestamptz := clock_timestamp();
  request_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  log_context jsonb;
  failed_constraint text;
  failed_table text;
  failed_column text;
begin
  log_context := jsonb_build_object(
    'rpc', 'species_deactivate', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'species_id', p_id, 'actor_id', p_actor_id
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  perform 1 from public.users where id = p_actor_id and deactivated_at is null for share;
  if not found then
    raise exception using errcode = 'PT500', message = 'Development audit user is missing or inactive.';
  end if;
  stage := 'lock_species';
  select deactivated_at into original_deactivated_at
  from public.species where id = p_id for update;
  if not found then
    raise exception using errcode = 'PT404', message = 'Species not found.';
  end if;

  if original_deactivated_at is not null then
    raise log '%', log_context || jsonb_build_object(
      'timestamp', clock_timestamp(), 'level', 'info',
      'event', 'database.function.completed', 'stage', stage,
      'outcome', 'already_inactive',
      'duration_ms', round(extract(epoch from clock_timestamp() - started_at) * 1000)
    );
    return;
  end if;

  stage := 'deactivate_species';
  mutation_time := clock_timestamp();
  update public.species set
    deactivated_at = mutation_time, updated_at = mutation_time, updated_by = p_actor_id
  where id = p_id;
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

revoke all on type public.species_event_row, public.species_detail_rows from public, anon, authenticated;
grant usage on type public.species_event_row, public.species_detail_rows to service_role;
revoke execute on function public.species_get(text), public.species_deactivate(text, text),
  public.species_create(text, text, text, text, text[], text, text, boolean),
  public.species_update(text, text, text, text, text[], text, text, boolean)
from public, anon, authenticated;
grant execute on function public.species_get(text), public.species_deactivate(text, text),
  public.species_create(text, text, text, text, text[], text, text, boolean),
  public.species_update(text, text, text, text, text[], text, text, boolean)
to service_role;

commit;
