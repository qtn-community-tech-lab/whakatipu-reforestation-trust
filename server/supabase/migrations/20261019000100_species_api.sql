begin;

-- Keep the PostgREST role restricted; the Edge API connects through the
-- transaction pool using its server-side database URL.
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

commit;
