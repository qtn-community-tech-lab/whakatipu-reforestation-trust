import type { Geometry, PlantingEventType } from "@wrt/api-types";
import type { Database } from "../_shared/database.types.ts";

export type { Database };
export type SpeciesRow = Database["public"]["Tables"]["species"]["Row"];

// Composite introspection marks every field nullable. These result types describe
// the non-null values guaranteed by species_get's joins, aggregates and checks.
export interface SpeciesEventRow {
  id: string;
  site_id: string;
  site_name: string;
  site_is_public: boolean;
  planting_area_id: string | null;
  planting_area_name: string | null;
  planting_date: string;
  event_type: PlantingEventType;
  season: string;
  image_url: string;
  species_ids: string[];
  total_plants: number;
  is_public: boolean;
}

export interface SpeciesDetailRows {
  species: SpeciesRow;
  total_plants: number;
  planting_event_count: number;
  events: SpeciesEventRow[];
}

export type SiteRow = Database["public"]["Tables"]["sites"]["Row"];

// The database currently permits Point geometry only. Keep the shared geometry
// type so API assembly does not invent a second geometry contract.
export interface SiteListRow extends SiteRow {
  location:
    | { id: string; geometry: Geometry; deactivated_at: string | null }
    | null;
}

export interface SiteDetailRows {
  site: SiteRow;
  location: { id: string; geometry: Geometry } | null;
  total_plants: number;
  planting_event_count: number;
  species_totals: { species: SpeciesRow; quantity: number }[];
  areas: {
    id: string;
    name: string;
    is_public: boolean;
    geometry: Geometry | null;
  }[];
  events: SpeciesEventRow[];
}

export type PlantingAreaRow =
  Database["public"]["Tables"]["planting_areas"]["Row"];

// Inner parent join excludes areas under inactive sites. SQL constrains stored
// geometry and guarantees non-null aggregate values and complete arrays.
export interface PlantingAreaListRow extends PlantingAreaRow {
  site: { id: string; name: string; is_public: boolean };
  location:
    | { id: string; geometry: Geometry; deactivated_at: string | null }
    | null;
}

export interface PlantingAreaDetailRows {
  area: PlantingAreaRow;
  site: SiteRow;
  location: { id: string; geometry: Geometry } | null;
  total_plants: number;
  planting_event_count: number;
  species_totals: { species: SpeciesRow; quantity: number }[];
  events: SpeciesEventRow[];
}

export type PlantingEventRow =
  Database["public"]["Tables"]["planting_events"]["Row"];

// The SQL joins require the site/catalogue and return every active count row.
export interface PlantingEventDetailRows {
  event: PlantingEventRow & { event_type: PlantingEventType };
  site: SiteRow;
  area: PlantingAreaRow | null;
  location: { id: string; geometry: Geometry } | null;
  total_plants: number;
  lines: { id: string; species: SpeciesRow; quantity: number }[];
}
