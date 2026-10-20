import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SiteCreateRequest,
  SiteListResponse,
  SiteResponse,
  SiteUpdateRequest,
} from "@wrt/api-types";
import type {
  Database,
  SiteDetailRows,
  SiteListRow,
} from "./database.types.ts";
import { plantingEventListResponse, position } from "./responses.ts";
import { generateUniqueID, IdPrefixes } from "../_shared/ids.ts";
import { DEVELOPMENT_ACTOR_ID } from "./config.ts";
import { HttpError } from "./http.ts";
import { queryDatabase } from "./database.ts";
import type { RequestLog } from "./logging.ts";

function siteListResponse(row: SiteListRow): SiteListResponse {
  return {
    id: row.id,
    name: row.name,
    is_public: row.is_public,
    position: position(
      row.location?.deactivated_at === null ? row.location.geometry : null,
    ),
  };
}

function siteResponse(result: SiteDetailRows): SiteResponse {
  const { site, location } = result;
  const parent = { id: site.id, name: site.name, is_public: site.is_public };
  return {
    id: site.id,
    name: site.name,
    is_public: site.is_public,
    position: position(location?.geometry ?? null),
    description: site.description,
    created_at: site.created_at,
    updated_at: site.updated_at,
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
    planting_areas: result.areas.map((area) => ({
      id: area.id,
      name: area.name,
      site: parent,
      position: position(area.geometry),
      is_public: area.is_public,
    })),
    planting_events: result.events.map(plantingEventListResponse),
  };
}

export async function listSites(
  db: SupabaseClient<Database>,
  log: RequestLog,
): Promise<SiteListResponse[]> {
  const started = performance.now();
  log("sites.list.started");
  const result: SiteListResponse[] = [];
  let offset = 0;
  while (true) {
    const queryStarted = performance.now();
    log("sites.list.batch.started", { offset, batch_size: 500 });
    const data = await queryDatabase(
      "sites.list.batch",
      log,
      () =>
        db.from("sites").select(
          "*, location:locations!sites_location_id_fkey(id, geometry, deactivated_at)",
        )
          .is("deactivated_at", null)
          .order("name").order("id")
          .range(offset, offset + 499)
          .overrideTypes<SiteListRow[], { merge: false }>(),
    );
    log("sites.list.batch.completed", {
      offset,
      row_count: data.length,
      duration_ms: Math.round(performance.now() - queryStarted),
    });
    if (data.length === 0) {
      log("sites.list.completed", {
        row_count: result.length,
        duration_ms: Math.round(performance.now() - started),
      });
      return result;
    }
    result.push(...data.map(siteListResponse));
    // Advance by actual rows, even if the project's cap is below our batch size.
    offset += data.length;
  }
}

export async function getSite(
  db: SupabaseClient<Database>,
  id: string,
  log: RequestLog,
): Promise<SiteResponse> {
  const started = performance.now();
  log("sites.get.started", { site_id: id, rpc: "site_get" });
  const data = await queryDatabase(
    "site_get",
    log,
    () =>
      db.rpc("site_get", { p_id: id })
        .maybeSingle().overrideTypes<SiteDetailRows, { merge: false }>(),
  );
  if (data === null) {
    log("sites.get.not_found", { site_id: id }, "warn");
    throw new HttpError(404, "not_found", "Site not found.");
  }
  const response = siteResponse(data);
  log("sites.get.completed", {
    site_id: id,
    event_count: data.events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

function editableArguments(body: SiteUpdateRequest) {
  // Forward only editable fields; caller audit/ID fields never reach the RPC.
  return {
    p_name: body.name,
    p_description: body.description,
    p_is_public: body.is_public,
    p_geometry: body.location?.geometry ?? null,
    // Used only when the transaction needs a new location; ignored otherwise.
    p_location_id: generateUniqueID(IdPrefixes.LOCATION),
  };
}

export async function createSite(
  db: SupabaseClient<Database>,
  body: SiteCreateRequest,
  log: RequestLog,
): Promise<SiteResponse> {
  const id = generateUniqueID(IdPrefixes.SITE);
  const started = performance.now();
  log("sites.create.started", {
    site_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "site_create",
  });
  const data = await queryDatabase(
    "site_create",
    log,
    () =>
      db.rpc("site_create", {
        ...editableArguments(body),
        p_actor_id: DEVELOPMENT_ACTOR_ID,
        p_id: id,
      }).single().overrideTypes<SiteDetailRows, { merge: false }>(),
  );
  if (data === null) {
    log("sites.create.empty_result", { site_id: id }, "error");
    throw new HttpError(
      500,
      "internal_error",
      "The request could not be completed.",
    );
  }
  const response = siteResponse(data);
  log("sites.create.completed", {
    site_id: id,
    event_count: data.events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function updateSite(
  db: SupabaseClient<Database>,
  id: string,
  body: SiteUpdateRequest,
  log: RequestLog,
): Promise<SiteResponse> {
  const started = performance.now();
  log("sites.update.started", {
    site_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "site_update",
  });
  const data = await queryDatabase(
    "site_update",
    log,
    () =>
      db.rpc("site_update", {
        ...editableArguments(body),
        p_actor_id: DEVELOPMENT_ACTOR_ID,
        p_id: id,
      }).single().overrideTypes<SiteDetailRows, { merge: false }>(),
  );
  if (data === null) {
    log("sites.update.empty_result", { site_id: id }, "error");
    throw new HttpError(
      500,
      "internal_error",
      "The request could not be completed.",
    );
  }
  const response = siteResponse(data);
  log("sites.update.completed", {
    site_id: id,
    event_count: data.events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function deactivateSite(
  db: SupabaseClient<Database>,
  id: string,
  log: RequestLog,
): Promise<void> {
  const started = performance.now();
  log("sites.deactivate.started", {
    site_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
    rpc: "site_deactivate",
  });
  await queryDatabase("site_deactivate", log, () =>
    db.rpc("site_deactivate", {
      p_actor_id: DEVELOPMENT_ACTOR_ID,
      p_id: id,
    }));
  // The RPC is idempotent; this does not imply a new deactivation timestamp.
  log("sites.deactivate.completed", {
    site_id: id,
    duration_ms: Math.round(performance.now() - started),
  });
}
