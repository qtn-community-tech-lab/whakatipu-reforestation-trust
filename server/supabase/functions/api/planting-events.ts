import { generateUniqueID, IdPrefixes } from "../_shared/ids.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlantingEventListResponse,
  PlantingEventResponse,
  PlantingEventUpdateRequest,
} from "@wrt/api-types";
import type {
  Database,
  PlantingEventDetailRows,
  SpeciesEventRow,
} from "./database.types.ts";
import { plantingEventListResponse } from "./responses.ts";
import { DEVELOPMENT_ACTOR_ID } from "./config.ts";
import { HttpError } from "./http.ts";
import { queryDatabase } from "./database.ts";
import type { RequestLog } from "./logging.ts";

function eventResponse(result: PlantingEventDetailRows): PlantingEventResponse {
  const { event, site, area, location } = result;
  return {
    id: event.id,
    site: { id: site.id, name: site.name, is_public: site.is_public },
    planting_area: area === null ? null : {
      id: area.id,
      name: area.name,
      is_active: area.deactivated_at === null,
    },
    planting_date: event.planting_date,
    event_type: event.event_type,
    season: event.season,
    species_ids: result.lines.filter((line) =>
      line.quantity > 0 && line.species.deactivated_at === null
    ).map((line) => line.species.id),
    total_plants: result.total_plants,
    is_public: event.is_public,
    created_at: event.created_at,
    updated_at: event.updated_at,
    notes: event.notes,
    image_url: event.image_url,
    location: location === null
      ? null
      : { id: location.id, geometry: location.geometry },
    species: result.lines.map((line) => ({
      id: line.id,
      species: {
        id: line.species.id,
        scientific_name: line.species.scientific_name,
        common_name: line.species.common_name,
        image_url: line.species.image_url,
        is_active: line.species.deactivated_at === null,
      },
      quantity: line.quantity,
    })),
  };
}

export async function listPlantingEvents(
  db: SupabaseClient<Database>,
  log: RequestLog,
): Promise<PlantingEventListResponse[]> {
  const started = performance.now();
  log("planting_events.list.started", { rpc: "planting_event_list" });
  const data = await queryDatabase(
    "planting_event_list",
    log,
    () =>
      db.rpc("planting_event_list").single()
        .overrideTypes<{ events: SpeciesEventRow[] }, { merge: false }>(),
  );
  const response = data.events.map(plantingEventListResponse);
  log("planting_events.list.completed", {
    row_count: response.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function getPlantingEvent(
  db: SupabaseClient<Database>,
  id: string,
  log: RequestLog,
): Promise<PlantingEventResponse> {
  const started = performance.now();
  log("planting_events.get.started", {
    planting_event_id: id,
    rpc: "planting_event_get",
  });
  const data = await queryDatabase(
    "planting_event_get",
    log,
    () =>
      db.rpc("planting_event_get", { p_id: id })
        .maybeSingle()
        .overrideTypes<PlantingEventDetailRows, { merge: false }>(),
  );
  if (data === null) {
    throw new HttpError(404, "not_found", "Planting event not found.", {
      reason: "planting_event_not_found",
    });
  }
  const response = eventResponse(data);
  log("planting_events.get.completed", {
    planting_event_id: id,
    line_count: data.lines.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function savePlantingEvent(
  db: SupabaseClient<Database>,
  id: string,
  body: PlantingEventUpdateRequest,
  create: boolean,
  log: RequestLog,
): Promise<PlantingEventResponse> {
  const started = performance.now();
  const operation = create ? "create" : "update";
  log(`planting_events.${operation}.started`, {
    planting_event_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "planting_event_save",
  });
  const data = await queryDatabase(
    "planting_event_save",
    log,
    () =>
      db.rpc("planting_event_save", {
        p_create: create,
        p_id: id,
        p_actor_id: DEVELOPMENT_ACTOR_ID,
        p_site_id: body.site_id,
        // The generated RPC text argument cannot express null; SQL maps empty text to null.
        p_planting_area_id: body.planting_area_id ?? "",
        p_planting_date: body.planting_date,
        p_event_type: body.event_type,
        p_season: body.season,
        p_notes: body.notes,
        p_image_url: body.image_url,
        p_is_public: body.is_public,
        p_species: body.species.map((line) => ({
          id: line.id ?? generateUniqueID(IdPrefixes.PLANTING_EVENT_SPECIES),
          species_id: line.species_id,
          quantity: line.quantity,
        })),
      }).single().overrideTypes<PlantingEventDetailRows, { merge: false }>(),
  );
  if (data === null) {
    throw new HttpError(
      500,
      "internal_error",
      "The request could not be completed.",
    );
  }
  const response = eventResponse(data);
  log(`planting_events.${operation}.completed`, {
    planting_event_id: id,
    line_count: data.lines.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function deactivatePlantingEvent(
  db: SupabaseClient<Database>,
  id: string,
  log: RequestLog,
): Promise<void> {
  const started = performance.now();
  log("planting_events.deactivate.started", {
    planting_event_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "planting_event_deactivate",
  });
  await queryDatabase(
    "planting_event_deactivate",
    log,
    () =>
      db.rpc("planting_event_deactivate", {
        p_id: id,
        p_actor_id: DEVELOPMENT_ACTOR_ID,
      }),
  );
  log("planting_events.deactivate.completed", {
    planting_event_id: id,
    duration_ms: Math.round(performance.now() - started),
  });
}
