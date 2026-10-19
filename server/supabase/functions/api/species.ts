import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SpeciesCreateRequest,
  SpeciesListResponse,
  SpeciesResponse,
  SpeciesUpdateRequest,
} from "@wrt/api-types";
import type {
  Database,
  SpeciesDetailRows,
  SpeciesRow,
} from "./database.types.ts";
import { plantingEventListResponse } from "./responses.ts";
import { generateUniqueID, IdPrefixes } from "../_shared/ids.ts";
import { DEVELOPMENT_ACTOR_ID } from "./config.ts";
import { HttpError, throwDatabaseError } from "./http.ts";
import type { RequestLog } from "./logging.ts";

function speciesListResponse(row: SpeciesRow): SpeciesListResponse {
  return {
    id: row.id,
    scientific_name: row.scientific_name,
    common_name: row.common_name,
    image_url: row.image_url,
    aliases: row.aliases,
    is_public: row.is_public,
  };
}

function speciesResponse(result: SpeciesDetailRows): SpeciesResponse {
  const { species, events } = result;
  return {
    ...speciesListResponse(species),
    description: species.description,
    created_at: species.created_at,
    updated_at: species.updated_at,
    totals: {
      planting_event_count: result.planting_event_count,
      total_plants: result.total_plants,
    },
    planting_events: events.map(plantingEventListResponse),
  };
}

export async function listSpecies(
  db: SupabaseClient<Database>,
  log: RequestLog,
): Promise<SpeciesListResponse[]> {
  const started = performance.now();
  log("species.list.started");
  const result: SpeciesListResponse[] = [];
  let offset = 0;
  while (true) {
    const queryStarted = performance.now();
    log("species.list.batch.started", { offset, batch_size: 500 });
    const { data, error } = await db.from("species").select("*")
      .is("deactivated_at", null)
      .order("scientific_name").order("id")
      .range(offset, offset + 499);
    if (error) throwDatabaseError(error, log, queryStarted);
    log("species.list.batch.completed", {
      offset,
      row_count: data.length,
      duration_ms: Math.round(performance.now() - queryStarted),
    });
    if (data.length === 0) {
      log("species.list.completed", {
        row_count: result.length,
        duration_ms: Math.round(performance.now() - started),
      });
      return result;
    }
    result.push(...data.map(speciesListResponse));
    // Advance by actual rows, even if the project's cap is below our batch size.
    offset += data.length;
  }
}

export async function getSpecies(
  db: SupabaseClient<Database>,
  id: string,
  log: RequestLog,
): Promise<SpeciesResponse> {
  const started = performance.now();
  log("species.get.started", { species_id: id, rpc: "species_get" });
  const { data, error } = await db.rpc("species_get", { p_id: id })
    .maybeSingle().overrideTypes<SpeciesDetailRows, { merge: false }>();
  if (error) throwDatabaseError(error, log, started);
  if (data === null) {
    log("species.get.not_found", { species_id: id }, "warn");
    throw new HttpError(404, "not_found", "Species not found.");
  }
  const response = speciesResponse(data);
  log("species.get.completed", {
    species_id: id,
    event_count: data.events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

function editableArguments(body: SpeciesUpdateRequest) {
  // Forward only editable fields; caller audit/ID fields never reach the RPC.
  return {
    p_scientific_name: body.scientific_name,
    p_common_name: body.common_name,
    p_aliases: body.aliases,
    p_description: body.description,
    p_image_url: body.image_url,
    p_is_public: body.is_public,
  };
}

export async function createSpecies(
  db: SupabaseClient<Database>,
  body: SpeciesCreateRequest,
  log: RequestLog,
): Promise<SpeciesResponse> {
  const id = generateUniqueID(IdPrefixes.SPECIES);
  const started = performance.now();
  log("species.create.started", {
    species_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "species_create",
  });
  const { data, error } = await db.rpc("species_create", {
    ...editableArguments(body),
    p_actor_id: DEVELOPMENT_ACTOR_ID,
    p_id: id,
  }).single().overrideTypes<SpeciesDetailRows, { merge: false }>();
  if (error) throwDatabaseError(error, log, started);
  if (data === null) {
    log("species.create.empty_result", { species_id: id }, "error");
    throw new HttpError(
      500,
      "internal_error",
      "The request could not be completed.",
    );
  }
  const response = speciesResponse(data);
  log("species.create.completed", {
    species_id: id,
    event_count: data.events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function updateSpecies(
  db: SupabaseClient<Database>,
  id: string,
  body: SpeciesUpdateRequest,
  log: RequestLog,
): Promise<SpeciesResponse> {
  const started = performance.now();
  log("species.update.started", {
    species_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "species_update",
  });
  const { data, error } = await db.rpc("species_update", {
    ...editableArguments(body),
    p_actor_id: DEVELOPMENT_ACTOR_ID,
    p_id: id,
  }).single().overrideTypes<SpeciesDetailRows, { merge: false }>();
  if (error) throwDatabaseError(error, log, started);
  if (data === null) {
    log("species.update.empty_result", { species_id: id }, "error");
    throw new HttpError(
      500,
      "internal_error",
      "The request could not be completed.",
    );
  }
  const response = speciesResponse(data);
  log("species.update.completed", {
    species_id: id,
    event_count: data.events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function deactivateSpecies(
  db: SupabaseClient<Database>,
  id: string,
  log: RequestLog,
): Promise<void> {
  const started = performance.now();
  log("species.deactivate.started", {
    species_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "species_deactivate",
  });
  const { error } = await db.rpc("species_deactivate", {
    p_actor_id: DEVELOPMENT_ACTOR_ID,
    p_id: id,
  });
  if (error) throwDatabaseError(error, log, started);
  // The RPC is idempotent; this does not imply a new deactivation timestamp.
  log("species.deactivate.completed", {
    species_id: id,
    duration_ms: Math.round(performance.now() - started),
  });
}
