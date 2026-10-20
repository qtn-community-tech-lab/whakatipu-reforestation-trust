/**
 * Simplified WRT persisted rows; planning is deferred from this draft.
 * These are not API request DTOs or executable migrations.
 * See spec.md and the versioned Supabase migrations for persistence rules.
 */

import type {
  CalendarDate,
  Geometry,
  Id,
  PlantingEventType,
  Timestamp,
} from "../shared/api-types.ts";
export type {
  CalendarDate,
  Geometry,
  Id,
  LinearRing,
  PlantingEventType,
  Position,
  Timestamp,
} from "../shared/api-types.ts";

/** Shared by every editable table, including users and species-count rows. */
export interface EditableRow {
  id: Id;
  /** FK users.id; the user performing the insert/import. */
  created_by: Id;
  created_at: Timestamp;
  /** FK users.id; the user performing the latest mutation. */
  updated_by: Id;
  /** Set to created_at initially; refreshed on every change. */
  updated_at: Timestamp;
  /** null = active. Deactivation also updates updated_by and updated_at. */
  deactivated_at: Timestamp | null;
}

export interface User extends EditableRow {
  /** Canonical approved email used for initial Google identity binding. */
  email: string;
  display_name: string;
  /** Supabase Auth identity; separate from the domain ID. */
  auth_user_id: string | null;
}

export interface Site extends EditableRow {
  name: string;
  description: string;
  /** FK locations.id; unique when non-null. */
  location_id: Id | null;
  is_public: boolean;
}

export interface PlantingArea extends EditableRow {
  /** FK sites.id; required even if no location has been recorded. */
  site_id: Id;
  name: string;
  description: string;
  /** FK locations.id; unique when non-null. */
  location_id: Id | null;
  is_public: boolean;
}

export interface Location extends EditableRow {
  /** One geometry value, never separate competing pin/polygon fields. */
  geometry: Geometry;
}

export interface Species extends EditableRow {
  scientific_name: string;
  common_name: string;
  /** Native Postgres text array. */
  aliases: string[];
  description: string;
  image_url: string;
  is_public: boolean;
}

export interface PlantingEvent extends EditableRow {
  /** FK sites.id; all events have a site, including historical imports. */
  site_id: Id;
  /** FK planting_areas.id; optional where the historical area is unknown. */
  planting_area_id: Id | null;
  /** Actual planting date, YYYY-MM-DD, stored as a database DATE. */
  planting_date: CalendarDate;
  event_type: PlantingEventType;
  season: string;
  notes: string;
  image_url: string;
  is_public: boolean;
}

export interface PlantingEventSpecies extends EditableRow {
  /** FK planting_events.id. */
  planting_event_id: Id;
  /** FK species.id. */
  species_id: Id;
  /** Non-negative integer; an unknown quantity must not be imported as zero. */
  quantity: number;
}

/** Persisted table names and their complete row shapes. */
export interface DatabaseTables {
  users: User;
  sites: Site;
  planting_areas: PlantingArea;
  locations: Location;
  species: Species;
  planting_events: PlantingEvent;
  planting_event_species: PlantingEventSpecies;
}
