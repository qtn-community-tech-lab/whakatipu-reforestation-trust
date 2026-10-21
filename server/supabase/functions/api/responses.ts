import type {
  Geometry,
  PlantingEventListResponse,
  PlantingEventType,
  Position,
} from "@wrt/api-types";
import { dateString } from "./database-helpers.ts";

export interface PlantingEventSummaryRow {
  id: string;
  site_id: string;
  site_name: string;
  site_is_public: boolean;
  planting_area_id: string | null;
  planting_area_name: string | null;
  planting_date: Date | string;
  event_type: PlantingEventType;
  season: string;
  image_url: string;
  species_ids: string[];
  total_plants: number;
  is_public: boolean;
}

export function position(geometry: Geometry | null) {
  // Phase one stores Points only; polygons remain a future contract extension.
  return (
    geometry?.type === "Point" ? geometry.coordinates : null
  ) satisfies Position | null;
}

export function plantingEventListResponse(event: PlantingEventSummaryRow) {
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
    planting_date: dateString(event.planting_date),
    event_type: event.event_type,
    season: event.season,
    image_url: event.image_url,
    species_ids: event.species_ids,
    total_plants: event.total_plants,
    is_public: event.is_public,
  } satisfies PlantingEventListResponse;
}
