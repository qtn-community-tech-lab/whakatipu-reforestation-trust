begin;

-- WRT application rows use caller-supplied 16-character IDs and shared audit
-- fields. Supabase's auth.users table remains managed by Supabase Auth.
create table public.users (
  id text primary key constraint users_id_length_check check (char_length(id) = 16),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  email text not null,
  display_name text not null,
  auth_user_id uuid unique,

  constraint users_created_by_fkey
    foreign key (created_by) references public.users (id) on delete restrict,
  constraint users_updated_by_fkey
    foreign key (updated_by) references public.users (id) on delete restrict,
  constraint users_updated_at_check check (updated_at >= created_at),
  constraint users_email_nonblank_check check (length(btrim(email)) > 0),
  constraint users_email_canonical_check check (email = lower(btrim(email))),
  constraint users_display_name_nonblank_check check (length(btrim(display_name)) > 0),
  constraint users_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users (id) on delete restrict
);

insert into public.users (id, created_by, updated_by, email, display_name)
values (
  'usr_000000000001', 'usr_000000000001', 'usr_000000000001',
  'bayly.james@gmail.com', 'James Bayly'
),
(
  'usr_000000000002', 'usr_000000000001', 'usr_000000000001',
  'ktgcreative@gmail.com', 'Kyle Grattan'
)
on conflict (id) do nothing;


create table public.locations (
  id text primary key constraint locations_id_length_check check (char_length(id) = 16),
  created_by text not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by text not null references public.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  geometry jsonb not null,

  constraint locations_updated_at_check check (updated_at >= created_at),
  constraint locations_geometry_point_check check (
    case
      when jsonb_typeof(geometry) is distinct from 'object' then false
      when geometry ->> 'type' is distinct from 'Point' then false
      when geometry - 'type' - 'coordinates' <> '{}'::jsonb then false
      when jsonb_typeof(geometry -> 'coordinates') is distinct from 'array' then false
      when jsonb_array_length(geometry -> 'coordinates') <> 2 then false
      when jsonb_typeof(geometry -> 'coordinates' -> 0) is distinct from 'number' then false
      when jsonb_typeof(geometry -> 'coordinates' -> 1) is distinct from 'number' then false
      else
        (geometry -> 'coordinates' ->> 0)::numeric between -180 and 180
        and (geometry -> 'coordinates' ->> 1)::numeric between -90 and 90
    end
  )
);

create table public.sites (
  id text primary key constraint sites_id_length_check check (char_length(id) = 16),
  created_by text not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by text not null references public.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  name text not null,
  description text not null default '',
  location_id text unique references public.locations (id) on delete restrict,
  is_public boolean not null default false,

  constraint sites_updated_at_check check (updated_at >= created_at),
  constraint sites_name_nonblank_check check (length(btrim(name)) > 0)
);

create table public.planting_areas (
  id text primary key constraint planting_areas_id_length_check check (char_length(id) = 16),
  created_by text not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by text not null references public.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  site_id text not null references public.sites (id) on delete restrict,
  name text not null,
  description text not null default '',
  location_id text unique references public.locations (id) on delete restrict,
  is_public boolean not null default false,

  constraint planting_areas_updated_at_check check (updated_at >= created_at),
  constraint planting_areas_name_nonblank_check check (length(btrim(name)) > 0)
);

create table public.species (
  id text primary key constraint species_id_length_check check (char_length(id) = 16),
  created_by text not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by text not null references public.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  scientific_name text not null,
  common_name text not null,
  aliases text[] not null default '{}',
  description text not null default '',
  image_url text not null default '',
  is_public boolean not null default false,

  constraint species_updated_at_check check (updated_at >= created_at),
  constraint species_scientific_name_nonblank_check check (length(btrim(scientific_name)) > 0),
  constraint species_common_name_nonblank_check check (length(btrim(common_name)) > 0),
  constraint species_aliases_no_nulls_check check (array_position(aliases, null) is null),
  constraint species_aliases_one_dimension_check check (coalesce(array_ndims(aliases), 1) = 1)
);

create table public.planting_events (
  id text primary key constraint planting_events_id_length_check check (char_length(id) = 16),
  created_by text not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by text not null references public.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  site_id text not null references public.sites (id) on delete restrict,
  planting_area_id text references public.planting_areas (id) on delete restrict,
  planting_date date not null,
  event_type text not null,
  season text not null default '',
  notes text not null default '',
  image_url text not null default '',
  is_public boolean not null default false,

  constraint planting_events_updated_at_check check (updated_at >= created_at),
  constraint planting_events_date_year_check
    check (extract(year from planting_date) between 1 and 9999),
  constraint planting_events_type_check
    check (event_type in ('establishment', 'infill', 'replacement'))
);

create table public.planting_event_species (
  id text primary key constraint planting_event_species_id_length_check check (char_length(id) = 16),
  created_by text not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by text not null references public.users (id) on delete restrict,
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  planting_event_id text not null references public.planting_events (id) on delete restrict,
  species_id text not null references public.species (id) on delete restrict,
  quantity bigint not null,

  constraint planting_event_species_updated_at_check check (updated_at >= created_at),
  constraint planting_event_species_quantity_check
    check (quantity between 0 and 9007199254740991)
);

-- These indexes support the access paths described in the API specification.
create index planting_areas_site_id_idx on public.planting_areas (site_id);
create index planting_events_site_date_idx
  on public.planting_events (site_id, planting_date desc, id desc)
  where deactivated_at is null;
create index planting_events_area_date_idx
  on public.planting_events (planting_area_id, planting_date desc, id desc)
  where planting_area_id is not null and deactivated_at is null;
create index planting_event_species_event_id_idx
  on public.planting_event_species (planting_event_id);
create index planting_event_species_species_id_idx
  on public.planting_event_species (species_id);
create unique index planting_event_species_active_pair_idx
  on public.planting_event_species (planting_event_id, species_id)
  where deactivated_at is null;

-- Domain tables are reachable through the Edge API and operator tooling only.
-- RLS has no browser-facing policies; the privileged API must enforce viewer scope.
alter table public.users enable row level security;
alter table public.locations enable row level security;
alter table public.sites enable row level security;
alter table public.planting_areas enable row level security;
alter table public.species enable row level security;
alter table public.planting_events enable row level security;
alter table public.planting_event_species enable row level security;

revoke all privileges on table
  public.users,
  public.locations,
  public.sites,
  public.planting_areas,
  public.species,
  public.planting_events,
  public.planting_event_species
from public, anon, authenticated;

grant all privileges on table
  public.users,
  public.locations,
  public.sites,
  public.planting_areas,
  public.species,
  public.planting_events,
  public.planting_event_species
to service_role;

-- Keep newly created objects closed by default for browser roles too.
alter default privileges in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
