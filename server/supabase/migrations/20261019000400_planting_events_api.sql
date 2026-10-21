begin;

create index planting_events_active_date_idx
  on public.planting_events (planting_date desc, id desc) where deactivated_at is null;

commit;
