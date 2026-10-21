import type { ColumnType, Generated } from "kysely";
import type { Geometry, PlantingEventType } from "@wrt/api-types";

/**
 * Kysely representation of the seven public domain tables in the SQL migrations.
 * Column types describe Postgres.js driver results, not HTTP response values.
 * Kysely does not convert runtime values: DTO mapping must format dates/timestamps
 * and check bigint aggregates before converting them to JavaScript numbers.
 */
export interface Database {
  users: UserTable;
  locations: LocationTable;
  sites: SiteTable;
  planting_areas: PlantingAreaTable;
  species: SpeciesTable;
  planting_events: PlantingEventTable;
  planting_event_species: PlantingEventSpeciesTable;
}

// Postgres supplies now() when these columns are omitted on insert. Explicit
// writes may use a Date or an ISO timestamp; Postgres.js reads as Date values.
type DefaultTimestamp = ColumnType<
  Date,
  Date | string | undefined,
  Date | string
>;
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

export interface EditableTable {
  // IDs and audit actors are supplied by trusted application code, not defaults.
  id: string;
  created_by: string;
  created_at: DefaultTimestamp;
  updated_by: string;
  updated_at: DefaultTimestamp;
  deactivated_at: NullableTimestamp;
}

export interface UserTable extends EditableTable {
  email: string;
  display_name: string;
  auth_user_id: Generated<string | null>;
}

export interface LocationTable extends EditableTable {
  // The current SQL constraint permits Point only; the HTTP contract also has
  // Polygon for future use. Postgres.js parses jsonb without a JSON plugin.
  geometry: Extract<Geometry, { type: "Point" }>;
}

export interface SiteTable extends EditableTable {
  name: string;
  description: Generated<string>;
  location_id: Generated<string | null>;
  is_public: Generated<boolean>;
}

export interface PlantingAreaTable extends EditableTable {
  site_id: string;
  name: string;
  description: Generated<string>;
  location_id: Generated<string | null>;
  is_public: Generated<boolean>;
}

export interface SpeciesTable extends EditableTable {
  scientific_name: string;
  common_name: string;
  aliases: Generated<string[]>;
  description: Generated<string>;
  image_url: Generated<string>;
  is_public: Generated<boolean>;
}

export interface PlantingEventTable extends EditableTable {
  site_id: string;
  planting_area_id: Generated<string | null>;
  // Postgres.js returns DATE as a Date. Write calendar strings (YYYY-MM-DD)
  // rather than instants, and preserve calendar semantics when mapping reads.
  planting_date: ColumnType<Date, string, string>;
  event_type: PlantingEventType;
  season: Generated<string>;
  notes: Generated<string>;
  image_url: Generated<string>;
  is_public: Generated<boolean>;
}

export interface PlantingEventSpeciesTable extends EditableTable {
  planting_event_id: string;
  species_id: string;
  // Postgres.js returns int8 as text. Individual quantities have a safe-integer
  // SQL constraint, but sums can exceed it; do not parse int8 as Number.
  quantity: ColumnType<
    string,
    number | bigint | string,
    number | bigint | string
  >;
}
