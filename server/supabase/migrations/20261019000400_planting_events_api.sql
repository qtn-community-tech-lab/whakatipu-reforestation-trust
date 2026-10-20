begin;

create index planting_events_active_date_idx
  on public.planting_events (planting_date desc, id desc) where deactivated_at is null;

create type public.event_species_row as (
  id text,
  species public.species,
  quantity bigint
);
create type public.planting_event_detail_rows as (
  event public.planting_events,
  site public.sites,
  area public.planting_areas,
  location public.locations,
  total_plants numeric,
  lines public.event_species_row[]
);

create function public.planting_event_get(p_id text)
returns setof public.planting_event_detail_rows
language plpgsql stable security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  result public.planting_event_detail_rows;
  stage text := 'read_detail';
  started_at timestamptz := clock_timestamp();
  request_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  log_context jsonb;
  failed_constraint text;
  failed_table text;
  failed_column text;
begin
  log_context := jsonb_build_object(
    'rpc', 'planting_event_get', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'planting_event_id', p_id
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  -- A single snapshot includes every line, including zero and inactive species.
  select event, site, area, coalesce(area_location, site_location),
    (select coalesce(sum(line.quantity), 0) from public.planting_event_species line
      where line.planting_event_id = event.id and line.deactivated_at is null),
    array(select row(line.id, catalogue, line.quantity)::public.event_species_row
      from public.planting_event_species line
      join public.species catalogue on catalogue.id = line.species_id
      where line.planting_event_id = event.id and line.deactivated_at is null
      order by line.species_id)
  into result
  from public.planting_events event
  join public.sites site on site.id = event.site_id and site.deactivated_at is null
  left join public.planting_areas area on area.id = event.planting_area_id
  left join public.locations area_location
    on area_location.id = area.location_id and area.deactivated_at is null
      and area_location.deactivated_at is null
  left join public.locations site_location
    on site_location.id = site.location_id and site_location.deactivated_at is null
  where event.id = p_id and event.deactivated_at is null;
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
  if result.total_plants > 9007199254740991 then
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

-- One array-valued result avoids the Data API row cap and gives summaries a
-- consistent snapshot. TypeScript maps the typed rows to the HTTP contract.
create function public.planting_event_list()
returns table(events public.species_event_row[])
language plpgsql stable security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  summaries public.species_event_row[];
  summary public.species_event_row;
  stage text := 'read_summaries';
  started_at timestamptz := clock_timestamp();
  request_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  log_context jsonb;
  failed_constraint text;
  failed_table text;
  failed_column text;
begin
  log_context := jsonb_build_object(
    'rpc', 'planting_event_list', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path'
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  select array(
    select row(event.id, site.id, site.name, site.is_public, area.id, area.name,
      event.planting_date, event.event_type,
      coalesce(quantities.species_ids, '{}'::text[]),
      quantities.total_plants, event.is_public, event.season, event.image_url)::public.species_event_row
    from public.planting_events event
    join public.sites site on site.id = event.site_id and site.deactivated_at is null
    left join public.planting_areas area
      on area.id = event.planting_area_id and area.deactivated_at is null
    cross join lateral (
      select coalesce(sum(line.quantity), 0) as total_plants,
        array_agg(line.species_id order by line.species_id)
          filter (where line.quantity > 0 and catalogue.deactivated_at is null) as species_ids
      from public.planting_event_species line
      join public.species catalogue on catalogue.id = line.species_id
      where line.planting_event_id = event.id and line.deactivated_at is null
    ) quantities
    where event.deactivated_at is null
    order by event.planting_date desc, event.id desc
  ) into summaries;
  stage := 'check_aggregates';
  foreach summary in array summaries loop
    if summary.total_plants > 9007199254740991 then
      raise sqlstate 'PT409' using message = 'Aggregate exceeds the safe integer range.';
    end if;
  end loop;
  return query select summaries;
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.completed', 'stage', stage,
    'outcome', 'success',
    'event_count', cardinality(summaries),
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

-- Create and full replacement share the desired-set transaction. JSONB is only
-- the input line set; returned rows remain typed and DTO assembly stays in TS.
create function public.planting_event_save(
  p_create boolean, p_id text, p_actor_id text, p_site_id text,
  p_planting_area_id text, p_planting_date date, p_event_type text,
  p_notes text, p_image_url text, p_is_public boolean, p_species jsonb, p_season text
)
returns setof public.planting_event_detail_rows
language plpgsql security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  saved public.planting_events;
  selected_area public.planting_areas;
  line record;
  existing public.planting_event_species;
  catalogue public.species;
  old_site_id text;
  area_id text := nullif(p_planting_area_id, '');
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
    'rpc', 'planting_event_save', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'planting_event_id', p_id, 'actor_id', p_actor_id
  );
  raise log '%', log_context || jsonb_build_object(
    'timestamp', clock_timestamp(), 'level', 'info',
    'event', 'database.function.started', 'stage', stage
  );

  perform 1 from public.users where id = p_actor_id and deactivated_at is null for share;
  if not found then
    raise sqlstate 'PT500' using message = 'Audit actor unavailable.';
  end if;

  stage := 'lock_parents';
  if not p_create then
    select site_id into old_site_id from public.planting_events where id = p_id;
  end if;
  -- Parent locks precede the event lock; sorting also supports cross-site saves.
  perform 1 from public.sites where id in (old_site_id, p_site_id) order by id for share;
  stage := 'lock_event';
  if not p_create then
    select * into saved from public.planting_events where id = p_id and deactivated_at is null for update;
    if not found or not exists (
      select 1 from public.sites where id = saved.site_id and deactivated_at is null
    ) then
      raise sqlstate 'PT404' using message = 'Planting event not found.';
    end if;
    -- A concurrent save may have moved it after our initial parent lookup.
    -- Retry rather than taking a late parent lock in an inconsistent order.
    if saved.site_id is distinct from old_site_id then
      raise sqlstate 'PT409' using message = 'The event changed concurrently; retry the save.';
    end if;
  end if;
  stage := 'check_site';
  if not exists (select 1 from public.sites where id = p_site_id and deactivated_at is null) then
    raise sqlstate 'PT409' using message = 'Site unavailable.';
  end if;

  stage := 'check_area';
  if area_id is not null then
    select * into selected_area from public.planting_areas where id = area_id for share;
    if not found or selected_area.site_id is distinct from p_site_id then
      raise sqlstate 'PT409' using message = 'Area must belong to the selected site.';
    end if;
    if selected_area.deactivated_at is not null and (
      p_create or saved.planting_area_id is distinct from area_id or saved.site_id is distinct from p_site_id
    ) then
      raise sqlstate 'PT409' using message = 'Area unavailable.';
    end if;
  end if;

  stage := 'check_desired_counts';
  if (select count(*) <> count(distinct id) or count(*) <> count(distinct species_id)
    from jsonb_to_recordset(p_species) as desired(id text, species_id text, quantity bigint)) then
    raise sqlstate 'PT409' using message = 'Duplicate count or species IDs.';
  end if;

  stage := 'lock_species';
  -- Catalogue locks keep active checks valid until commit, in a stable order.
  perform 1 from public.species where id in (
    select species_id from jsonb_to_recordset(p_species) as desired(id text, species_id text, quantity bigint)
  ) order by id for share;

  stage := 'lock_counts';
  perform 1 from public.planting_event_species where planting_event_id = p_id order by id for update;

  stage := 'check_count_ownership_and_species';
  for line in select * from jsonb_to_recordset(p_species)
    as desired(id text, species_id text, quantity bigint) order by id
  loop
    select * into existing from public.planting_event_species where id = line.id;
    if found and existing.planting_event_id <> p_id then
      raise sqlstate 'PT409' using message = 'Count row belongs to another event.';
    end if;
    select * into catalogue from public.species where id = line.species_id;
    if not found then
      raise sqlstate 'PT409' using message = 'Species unavailable.';
    end if;
    if catalogue.deactivated_at is not null and (
      existing.id is null or existing.deactivated_at is not null
      or existing.species_id is distinct from line.species_id
    ) then
      raise sqlstate 'PT409' using message = 'Species unavailable.';
    end if;
  end loop;

  stage := 'save_event';
  changed_at := clock_timestamp();
  if p_create then
    insert into public.planting_events
      (id, created_by, updated_by, created_at, updated_at, site_id, planting_area_id,
       planting_date, event_type, notes, image_url, is_public, season)
    values (p_id, p_actor_id, p_actor_id, changed_at, changed_at, p_site_id, area_id,
      p_planting_date, p_event_type, p_notes, p_image_url, p_is_public, p_season);
  else
    update public.planting_events set site_id = p_site_id, planting_area_id = area_id,
      planting_date = p_planting_date, event_type = p_event_type, notes = p_notes,
      image_url = p_image_url, is_public = p_is_public, season = p_season,
      updated_at = changed_at, updated_by = p_actor_id where id = p_id;
  end if;

  stage := 'deactivate_previous_counts';
  -- Temporarily deactivate active rows so species swaps cannot collide with
  -- the partial unique index. All changes are invisible until commit.
  update public.planting_event_species
    set deactivated_at = changed_at, updated_at = changed_at, updated_by = p_actor_id
    where planting_event_id = p_id and deactivated_at is null;

  stage := 'save_counts';
  for line in select * from jsonb_to_recordset(p_species)
    as desired(id text, species_id text, quantity bigint) order by id
  loop
    insert into public.planting_event_species
      (id, created_by, updated_by, created_at, updated_at, planting_event_id, species_id, quantity)
    values (line.id, p_actor_id, p_actor_id, changed_at, changed_at, p_id, line.species_id, line.quantity)
    on conflict (id) do update set species_id = excluded.species_id, quantity = excluded.quantity,
      deactivated_at = null, updated_at = changed_at, updated_by = p_actor_id
    where public.planting_event_species.planting_event_id = p_id;
    -- A concurrent insert of the same ID by another event must not be a silent no-op.
    if not found then
      raise sqlstate 'PT409' using message = 'Count row belongs to another event.';
    end if;
  end loop;

  stage := 'read_saved_detail';
  return query select * from public.planting_event_get(p_id);
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

create function public.planting_event_deactivate(p_id text, p_actor_id text)
returns void
language plpgsql security invoker
set search_path = ''
set timezone = 'UTC'
as $$
declare
  saved public.planting_events;
  parent_id text;
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
    'rpc', 'planting_event_deactivate', 'request_id', request_headers ->> 'x-request-id',
    'method', request_headers ->> 'x-wrt-request-method',
    'path', request_headers ->> 'x-wrt-request-path',
    'planting_event_id', p_id, 'actor_id', p_actor_id
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
  select site_id into parent_id from public.planting_events where id = p_id;
  perform 1 from public.sites where id = parent_id and deactivated_at is null for share;
  if not found then
    raise sqlstate 'PT404' using message = 'Planting event not found.';
  end if;
  stage := 'lock_event';
  select * into saved from public.planting_events where id = p_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'Planting event not found.';
  end if;
  stage := 'check_parent';
  if saved.site_id is distinct from parent_id then
    raise sqlstate 'PT409' using message = 'The event changed concurrently; retry the delete.';
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
  stage := 'deactivate_event';
  changed_at := clock_timestamp();
  update public.planting_events set deactivated_at = changed_at, updated_at = changed_at, updated_by = p_actor_id
    where id = p_id;
  -- Count rows remain intact; inactive events are excluded from every aggregate.
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

revoke all on function public.planting_event_get(text), public.planting_event_list(),
  public.planting_event_save(boolean, text, text, text, text, date, text, text, text, boolean, jsonb, text),
  public.planting_event_deactivate(text, text) from public, anon, authenticated;
grant execute on function public.planting_event_get(text), public.planting_event_list(),
  public.planting_event_save(boolean, text, text, text, text, date, text, text, text, boolean, jsonb, text),
  public.planting_event_deactivate(text, text) to service_role;
revoke all on type public.event_species_row, public.planting_event_detail_rows from public, anon, authenticated;
grant usage on type public.event_species_row, public.planting_event_detail_rows to service_role;

commit;
