import type {
  Geometry,
  PlantingEventListResponse,
  Position,
} from "@wrt/api-types";
import type { SpeciesEventRow } from "./database.types.ts";

export function position(geometry: Geometry | null): Position | null {
  // Phase one stores Points only; polygons remain a future contract extension.
  return geometry?.type === "Point" ? geometry.coordinates : null;
}

export function plantingEventListResponse(
  event: SpeciesEventRow,
): PlantingEventListResponse {
  return {
    id: event.id,
    site: {
      id: event.site_id,
      name: event.site_name,
      is_public: event.site_is_public,
    },
    planting_area:
      event.planting_area_id === null || event.planting_area_name === null
        ? null
        : { id: event.planting_area_id, name: event.planting_area_name },
    planting_date: event.planting_date,
    event_type: event.event_type,
    species_ids: event.species_ids,
    total_plants: event.total_plants,
    is_public: event.is_public,
  };
}
