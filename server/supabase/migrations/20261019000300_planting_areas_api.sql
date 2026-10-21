begin;

create index planting_areas_active_name_idx
  on public.planting_areas (name, id) where deactivated_at is null;

commit;
