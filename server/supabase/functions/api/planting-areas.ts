import { sql } from "kysely";
import type { Kysely, Transaction } from "kysely";
import type {
  PlantingAreaCreateRequest,
  PlantingAreaListResponse,
  PlantingAreaResponse,
  PlantingAreaUpdateRequest,
} from "@wrt/api-types";
import type { Database } from "./database.schema.ts";
import { generateUniqueID, IdPrefixes } from "../_shared/ids.ts";
import { DEVELOPMENT_ACTOR_ID } from "./config.ts";
import {
  readLocation,
  requireAuditActor,
  storedGeometry,
} from "./database-helpers.ts";
import { readEventCollection } from "./event-data.ts";
import { HttpError } from "./http.ts";
import { databaseErrorLogFields, databaseHttpError } from "./database.ts";
import { logDatabaseStage } from "./logging.ts";
import type { RequestLog } from "./logging.ts";
import { position } from "./responses.ts";

async function areaDetail(
  trx: Transaction<Database>,
  id: string,
  log: RequestLog,
  operation: string,
) {
  logDatabaseStage(log, operation, "read_area");
  const row = await trx
    .selectFrom("planting_areas")
    .selectAll()
    .where("id", "=", id)
    .where("deactivated_at", "is", null)
    .executeTakeFirst();
  if (!row) return null satisfies PlantingAreaResponse | null;
  logDatabaseStage(log, operation, "read_site");
  const site = await trx
    .selectFrom("sites")
    .select(["id", "name", "is_public"])
    .where("id", "=", row.site_id)
    .where("deactivated_at", "is", null)
    .executeTakeFirst();
  if (!site) return null satisfies PlantingAreaResponse | null;
  const collection = await readEventCollection(trx, operation, log, {
    site_id: row.site_id,
    planting_area_id: id,
  });
  const location = await readLocation(trx, row.location_id, operation, log);
  return {
    id: row.id,
    name: row.name,
    site: {
      id: site.id,
      name: site.name,
      is_public: site.is_public,
    },
    is_public: row.is_public,
    position: position(location?.geometry ?? null),
    description: row.description,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    location,
    totals: {
      planting_event_count: collection.events.length,
      total_plants: collection.total_plants,
    },
    species_totals: collection.species_totals,
    planting_events: collection.events,
  } satisfies PlantingAreaResponse | null;
}

export async function listPlantingAreas(db: Kysely<Database>, log: RequestLog) {
  const started = performance.now();
  log("planting_areas.list.started");
  log.databaseStage = undefined;
  try {
    logDatabaseStage(log, "planting_areas.list", "read_planting_areas");
    const rows = await db
      .selectFrom("planting_areas as area")
      .innerJoin("sites as site", "site.id", "area.site_id")
      .leftJoin("locations as location", (join) =>
        join
          .onRef("location.id", "=", "area.location_id")
          .on("location.deactivated_at", "is", null),
      )
      .select([
        "area.id as id",
        "area.name as name",
        "area.is_public as is_public",
        "site.id as site_id",
        "site.name as site_name",
        "site.is_public as site_is_public",
        "location.geometry as location_geometry",
      ])
      .where("area.deactivated_at", "is", null)
      .where("site.deactivated_at", "is", null)
      .orderBy("area.name")
      .orderBy("area.id")
      .execute();
    const response = rows.map((row) => ({
      id: row.id,
      name: row.name,
      site: {
        id: row.site_id,
        name: row.site_name,
        is_public: row.site_is_public,
      },
      is_public: row.is_public,
      position: position(row.location_geometry),
    }));
    log("planting_areas.list.completed", {
      row_count: response.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies PlantingAreaListResponse[];
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "planting_areas.list.failed",
      {
        error_code: failure.code,
        reason: failure.reason,
        stage: log.databaseStage ?? null,
        ...databaseErrorLogFields(failure),
        duration_ms: Math.round(performance.now() - started),
      },
      failure.status >= 500 ? "error" : "warn",
    );
    throw failure;
  }
}

export async function getPlantingArea(
  db: Kysely<Database>,
  id: string,
  log: RequestLog,
) {
  const started = performance.now();
  log("planting_areas.get.started", { planting_area_id: id });
  log.databaseStage = undefined;
  try {
    const response = await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .execute(async (trx) => {
        await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
          trx,
        );

        return await areaDetail(trx, id, log, "planting_area.get");
      });
    if (!response) {
      log("planting_areas.get.not_found", { planting_area_id: id }, "warn");
      throw new HttpError(404, "not_found", "Planting area not found.", {
        reason: "planting_area_not_found",
      });
    }
    log("planting_areas.get.completed", {
      planting_area_id: id,
      event_count: response.planting_events.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies PlantingAreaResponse;
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "planting_areas.get.failed",
      {
        error_code: failure.code,
        reason: failure.reason,
        stage: log.databaseStage ?? null,
        ...databaseErrorLogFields(failure),
        duration_ms: Math.round(performance.now() - started),
      },
      failure.status >= 500 ? "error" : "warn",
    );
    throw failure;
  }
}

export async function createPlantingArea(
  db: Kysely<Database>,
  body: PlantingAreaCreateRequest,
  log: RequestLog,
) {
  const id = generateUniqueID(IdPrefixes.PLANTING_AREA);
  const started = performance.now();
  log("planting_areas.create.started", {
    planting_area_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
  });
  log.databaseStage = undefined;
  try {
    const response = await db.transaction().execute(async (trx) => {
      await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
        trx,
      );

      await requireAuditActor(trx, "planting_area.create", log);
      logDatabaseStage(log, "planting_area.create", "read_site");
      const site = await trx
        .selectFrom("sites")
        .select("id")
        .where("id", "=", body.site_id)
        .where("deactivated_at", "is", null)
        .executeTakeFirst();
      if (!site) {
        throw new HttpError(
          409,
          "conflict",
          "The selected site is missing or inactive.",
          {
            reason: "site_unavailable",
            fields: { site_id: "Select an active site." },
          },
        );
      }
      const location = body.location;
      if (location) {
        const geometry = storedGeometry(location.geometry);
        logDatabaseStage(log, "planting_area.create", "save_location");
        await trx
          .insertInto("locations")
          .values({
            id: location.id,
            geometry,
            created_by: DEVELOPMENT_ACTOR_ID,
            updated_by: DEVELOPMENT_ACTOR_ID,
          })
          .execute();
      }
      logDatabaseStage(log, "planting_area.create", "save_area");
      await trx
        .insertInto("planting_areas")
        .values({
          id,
          site_id: body.site_id,
          name: body.name,
          description: body.description,
          is_public: body.is_public,
          location_id: body.location?.id ?? null,
          created_by: DEVELOPMENT_ACTOR_ID,
          updated_by: DEVELOPMENT_ACTOR_ID,
        })
        .execute();
      const saved = await areaDetail(trx, id, log, "planting_area.create");
      if (!saved) {
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
      return saved;
    });
    log("planting_areas.create.completed", {
      planting_area_id: id,
      event_count: response.planting_events.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies PlantingAreaResponse;
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "planting_areas.create.failed",
      {
        error_code: failure.code,
        reason: failure.reason,
        stage: log.databaseStage ?? null,
        ...databaseErrorLogFields(failure),
        duration_ms: Math.round(performance.now() - started),
      },
      failure.status >= 500 ? "error" : "warn",
    );
    throw failure;
  }
}

async function readAreaForWrite(
  trx: Transaction<Database>,
  id: string,
  operation: string,
  log: RequestLog,
) {
  logDatabaseStage(log, operation, "read_area");
  return await trx
    .selectFrom("planting_areas as area")
    .innerJoin("sites as site", "site.id", "area.site_id")
    .select(["area.site_id", "area.location_id", "area.deactivated_at"])
    .where("area.id", "=", id)
    .where("site.deactivated_at", "is", null)
    .executeTakeFirst();
}

export async function updatePlantingArea(
  db: Kysely<Database>,
  id: string,
  body: PlantingAreaUpdateRequest,
  log: RequestLog,
) {
  const started = performance.now();
  log("planting_areas.update.started", {
    planting_area_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
  });
  log.databaseStage = undefined;
  try {
    const response = await db.transaction().execute(async (trx) => {
      await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
        trx,
      );

      await requireAuditActor(trx, "planting_area.update", log);
      const saved = await readAreaForWrite(
        trx,
        id,
        "planting_area.update",
        log,
      );
      if (!saved || saved.deactivated_at !== null) {
        throw new HttpError(404, "not_found", "Planting area not found.", {
          reason: "planting_area_not_found",
        });
      }
      logDatabaseStage(log, "planting_area.update", "check_parent");
      if (body.site_id !== saved.site_id) {
        throw new HttpError(
          409,
          "conflict",
          "A planting area's parent site cannot change.",
          {
            reason: "parent_site_immutable",
            fields: { site_id: "Keep the area's original site." },
          },
        );
      }

      const changedAt = sql<Date>`now()`;
      logDatabaseStage(log, "planting_area.update", "save_location");
      const locationId = await saveAreaLocation(
        trx,
        saved.location_id,
        body.location,
      );
      logDatabaseStage(log, "planting_area.update", "save_area");
      await trx
        .updateTable("planting_areas")
        .set({
          name: body.name,
          description: body.description,
          is_public: body.is_public,
          location_id: locationId,
          updated_at: changedAt,
          updated_by: DEVELOPMENT_ACTOR_ID,
        })
        .where("id", "=", id)
        .execute();
      const detail = await areaDetail(trx, id, log, "planting_area.update");
      if (!detail) {
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
      return detail;
    });
    log("planting_areas.update.completed", {
      planting_area_id: id,
      event_count: response.planting_events.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies PlantingAreaResponse;
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "planting_areas.update.failed",
      {
        error_code: failure.code,
        reason: failure.reason,
        stage: log.databaseStage ?? null,
        ...databaseErrorLogFields(failure),
        duration_ms: Math.round(performance.now() - started),
      },
      failure.status >= 500 ? "error" : "warn",
    );
    throw failure;
  }
}

export async function deactivatePlantingArea(
  db: Kysely<Database>,
  id: string,
  log: RequestLog,
) {
  const started = performance.now();
  log("planting_areas.deactivate.started", {
    planting_area_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
  });
  log.databaseStage = undefined;
  try {
    await db.transaction().execute(async (trx) => {
      await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
        trx,
      );

      await requireAuditActor(trx, "planting_area.deactivate", log);
      const saved = await readAreaForWrite(
        trx,
        id,
        "planting_area.deactivate",
        log,
      );
      if (!saved) {
        throw new HttpError(404, "not_found", "Planting area not found.", {
          reason: "planting_area_not_found",
        });
      }
      if (saved.deactivated_at !== null) {
        log("planting_areas.deactivate.already_inactive", {
          planting_area_id: id,
        });
        return;
      }
      const changedAt = sql<Date>`now()`;
      if (saved.location_id !== null) {
        const locationId = saved.location_id;
        logDatabaseStage(
          log,
          "planting_area.deactivate",
          "deactivate_location",
        );
        await trx
          .updateTable("locations")
          .set({
            deactivated_at: changedAt,
            updated_at: changedAt,
            updated_by: DEVELOPMENT_ACTOR_ID,
          })
          .where("id", "=", locationId)
          .where("deactivated_at", "is", null)
          .execute();
      }
      logDatabaseStage(log, "planting_area.deactivate", "deactivate_area");
      await trx
        .updateTable("planting_areas")
        .set({
          deactivated_at: changedAt,
          updated_at: changedAt,
          updated_by: DEVELOPMENT_ACTOR_ID,
        })
        .where("id", "=", id)
        .where("deactivated_at", "is", null)
        .execute();
    });
    log("planting_areas.deactivate.completed", {
      planting_area_id: id,
      duration_ms: Math.round(performance.now() - started),
    });
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "planting_areas.deactivate.failed",
      {
        error_code: failure.code,
        reason: failure.reason,
        stage: log.databaseStage ?? null,
        ...databaseErrorLogFields(failure),
        duration_ms: Math.round(performance.now() - started),
      },
      failure.status >= 500 ? "error" : "warn",
    );
    throw failure;
  }
}

async function saveAreaLocation(
  trx: Transaction<Database>,
  existingId: string | null,
  input: PlantingAreaUpdateRequest["location"],
) {
  const changedAt = sql<Date>`now()`;
  const location = input;
  if (location && location.id === existingId) {
    await trx
      .updateTable("locations")
      .set({
        geometry: storedGeometry(location.geometry),
        updated_at: changedAt,
        updated_by: DEVELOPMENT_ACTOR_ID,
      })
      .where("id", "=", location.id)
      .execute();
    return location.id satisfies string | null;
  }
  if (location) {
    await trx
      .insertInto("locations")
      .values({
        id: location.id,
        geometry: storedGeometry(location.geometry),
        created_by: DEVELOPMENT_ACTOR_ID,
        updated_by: DEVELOPMENT_ACTOR_ID,
      })
      .execute();
  }
  if (existingId !== null) {
    await trx
      .updateTable("locations")
      .set({
        deactivated_at: changedAt,
        updated_at: changedAt,
        updated_by: DEVELOPMENT_ACTOR_ID,
      })
      .where("id", "=", existingId)
      .where("deactivated_at", "is", null)
      .execute();
  }
  return (location?.id ?? null) satisfies string | null;
}
