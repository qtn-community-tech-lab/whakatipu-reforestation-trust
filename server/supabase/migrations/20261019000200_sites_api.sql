begin;

create index sites_active_name_idx
  on public.sites (name, id) where deactivated_at is null;

commit;
