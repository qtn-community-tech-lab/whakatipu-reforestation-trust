begin;

-- array_position raises an unsupported-operation error for multidimensional
-- arrays. Guard it so malformed aliases fail as ordinary constraint violations.
alter table public.species drop constraint species_aliases_no_nulls_check;
alter table public.species add constraint species_aliases_no_nulls_check check (
  case when coalesce(array_ndims(aliases), 1) = 1
    then array_position(aliases, null) is null
    else false
  end
);

commit;
