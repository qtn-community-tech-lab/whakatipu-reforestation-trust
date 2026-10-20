import { generateUniqueID, IdPrefixes } from "../_shared/ids.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlantingAreaCreateRequest,
  PlantingAreaListResponse,
  PlantingAreaResponse,
  PlantingAreaUpdateRequest,
} from "@wrt/api-types";
import type {
  Database,
  PlantingAreaDetailRows,
  PlantingAreaListRow,
} from "./database.types.ts";
import { plantingEventListResponse, position } from "./responses.ts";
import { DEVELOPMENT_ACTOR_ID } from "./config.ts";
import { HttpError } from "./http.ts";
import { queryDatabase } from "./database.ts";
import type { RequestLog } from "./logging.ts";

function areaListResponse(row: PlantingAreaListRow): PlantingAreaListResponse {
  return {
    id: row.id,
    name: row.name,
    site: {
      id: row.site.id,
      name: row.site.name,
      is_public: row.site.is_public,
    },
    is_public: row.is_public,
    position: position(
      row.location?.deactivated_at === null ? row.location.geometry : null,
    ),
  };
}

function areaResponse(result: PlantingAreaDetailRows): PlantingAreaResponse {
  const { area, site, location } = result;
  return {
    id: area.id,
    name: area.name,
    site: { id: site.id, name: site.name, is_public: site.is_public },
    is_public: area.is_public,
    position: position(location?.geometry ?? null),
    description: area.description,
    created_at: area.created_at,
    updated_at: area.updated_at,
    location: location === null
      ? null
      : { id: location.id, geometry: location.geometry },
    totals: {
      planting_event_count: result.planting_event_count,
      total_plants: result.total_plants,
    },
    species_totals: result.species_totals.map(({ species, quantity }) => ({
      species: {
        id: species.id,
        scientific_name: species.scientific_name,
        common_name: species.common_name,
        image_url: species.image_url,
      },
      quantity,
    })),
    planting_events: result.events.map(plantingEventListResponse),
  };
}

export async function listPlantingAreas(
  db: SupabaseClient<Database>,
  log: RequestLog,
): Promise<PlantingAreaListResponse[]> {
  const started = performance.now();
  log("planting_areas.list.started");
  const result: PlantingAreaListResponse[] = [];
  let offset = 0;
  while (true) {
    const queryStarted = performance.now();
    log("planting_areas.list.batch.started", { offset, batch_size: 500 });
    const data = await queryDatabase(
      "planting_areas.list.batch",
      log,
      () =>
        db.from("planting_areas").select(
          "*, site:sites!inner(id, name, is_public), location:locations!planting_areas_location_id_fkey(id, geometry, deactivated_at)",
        )
          .is("deactivated_at", null)
          .is("site.deactivated_at", null)
          .order("name").order("id")
          .range(offset, offset + 499)
          .overrideTypes<PlantingAreaListRow[], { merge: false }>(),
    );
    log("planting_areas.list.batch.completed", {
      offset,
      row_count: data.length,
      duration_ms: Math.round(performance.now() - queryStarted),
    });
    if (data.length === 0) {
      log("planting_areas.list.completed", {
        row_count: result.length,
        duration_ms: Math.round(performance.now() - started),
      });
      return result;
    }
    result.push(...data.map(areaListResponse));
    // Advance by actual rows, even if the project's cap is below our batch size.
    offset += data.length;
  }
}

export async function getPlantingArea(
  db: SupabaseClient<Database>,
  id: string,
  log: RequestLog,
): Promise<PlantingAreaResponse> {
  const started = performance.now();
  log("planting_areas.get.started", {
    planting_area_id: id,
    rpc: "planting_area_get",
  });
  const data = await queryDatabase(
    "planting_area_get",
    log,
    () =>
      db.rpc("planting_area_get", { p_id: id })
        .maybeSingle().overrideTypes<
        PlantingAreaDetailRows,
        { merge: false }
      >(),
  );
  if (data === null) {
    log("planting_areas.get.not_found", { planting_area_id: id }, "warn");
    throw new HttpError(404, "not_found", "Planting area not found.");
  }
  const response = areaResponse(data);
  log("planting_areas.get.completed", {
    planting_area_id: id,
    event_count: data.events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

function editableArguments(body: PlantingAreaUpdateRequest) {
  // Forward only editable fields; PUT IDs come from the path and audit identity is trusted.
  return {
    p_site_id: body.site_id,
    p_name: body.name,
    p_description: body.description,
    p_is_public: body.is_public,
    p_geometry: body.location?.geometry ?? null,
    // Generated RPC types require text; SQL ignores this argument for null geometry.
    p_location_id: body.location?.id ?? "",
  };
}

export async function createPlantingArea(
  db: SupabaseClient<Database>,
  body: PlantingAreaCreateRequest,
  log: RequestLog,
): Promise<PlantingAreaResponse> {
  const id = generateUniqueID(IdPrefixes.PLANTING_AREA);
  const started = performance.now();
  log("planting_areas.create.started", {
    planting_area_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "planting_area_create",
  });
  const data = await queryDatabase(
    "planting_area_create",
    log,
    () =>
      db.rpc("planting_area_create", {
        ...editableArguments(body),
        p_actor_id: DEVELOPMENT_ACTOR_ID,
        p_id: id,
      }).single().overrideTypes<PlantingAreaDetailRows, { merge: false }>(),
  );
  if (data === null) {
    log(
      "planting_areas.create.empty_result",
      { planting_area_id: id },
      "error",
    );
    throw new HttpError(
      500,
      "internal_error",
      "The request could not be completed.",
    );
  }
  const response = areaResponse(data);
  log("planting_areas.create.completed", {
    planting_area_id: id,
    event_count: data.events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function updatePlantingArea(
  db: SupabaseClient<Database>,
  id: string,
  body: PlantingAreaUpdateRequest,
  log: RequestLog,
): Promise<PlantingAreaResponse> {
  const started = performance.now();
  log("planting_areas.update.started", {
    planting_area_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "planting_area_update",
  });
  const data = await queryDatabase(
    "planting_area_update",
    log,
    () =>
      db.rpc("planting_area_update", {
        ...editableArguments(body),
        p_actor_id: DEVELOPMENT_ACTOR_ID,
        p_id: id,
      }).single().overrideTypes<PlantingAreaDetailRows, { merge: false }>(),
  );
  if (data === null) {
    log(
      "planting_areas.update.empty_result",
      { planting_area_id: id },
      "error",
    );
    throw new HttpError(
      500,
      "internal_error",
      "The request could not be completed.",
    );
  }
  const response = areaResponse(data);
  log("planting_areas.update.completed", {
    planting_area_id: id,
    event_count: data.events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function deactivatePlantingArea(
  db: SupabaseClient<Database>,
  id: string,
  log: RequestLog,
): Promise<void> {
  const started = performance.now();
  log("planting_areas.deactivate.started", {
    planting_area_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "planting_area_deactivate",
  });
  await queryDatabase(
    "planting_area_deactivate",
    log,
    () =>
      db.rpc("planting_area_deactivate", {
        p_actor_id: DEVELOPMENT_ACTOR_ID,
        p_id: id,
      }),
  );
  // The RPC is idempotent; this does not imply a new deactivation timestamp.
  log("planting_areas.deactivate.completed", {
    planting_area_id: id,
    duration_ms: Math.round(performance.now() - started),
  });
}
