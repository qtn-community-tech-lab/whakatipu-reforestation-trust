import type { PlantingEventType } from "@wrt/api-types";
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
