import { sql } from "kysely";
import type { Kysely, Transaction } from "kysely";
import type {
  SiteCreateRequest,
  SiteListResponse,
  SiteResponse,
  SiteUpdateRequest,
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

async function siteDetail(
  trx: Transaction<Database>,
  id: string,
  log: RequestLog,
  operation: string,
) {
  logDatabaseStage(log, operation, "read_site");
  const row = await trx
    .selectFrom("sites")
    .selectAll()
    .where("id", "=", id)
    .where("deactivated_at", "is", null)
    .executeTakeFirst();
  if (!row) return null satisfies SiteResponse | null;

  logDatabaseStage(log, operation, "read_areas");
  const areas = await trx
    .selectFrom("planting_areas as area")
    .leftJoin("locations as location", (join) =>
      join
        .onRef("location.id", "=", "area.location_id")
        .on("location.deactivated_at", "is", null),
    )
    .select([
      "area.id as id",
      "area.name as name",
      "area.is_public as is_public",
      "location.geometry as geometry",
    ])
    .where("area.site_id", "=", id)
    .where("area.deactivated_at", "is", null)
    .orderBy("area.name")
    .orderBy("area.id")
    .execute();
  const collection = await readEventCollection(trx, operation, log, {
    site_id: id,
  });
  const parent = { id: row.id, name: row.name, is_public: row.is_public };
  const location = await readLocation(trx, row.location_id, operation, log);
  return {
    id: row.id,
    name: row.name,
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
    planting_areas: areas.map((area) => ({
      id: area.id,
      name: area.name,
      site: parent,
      position: position(area.geometry),
      is_public: area.is_public,
    })),
    planting_events: collection.events,
  } satisfies SiteResponse | null;
}

export async function listSites(db: Kysely<Database>, log: RequestLog) {
  const started = performance.now();
  log("sites.list.started");
  log.databaseStage = undefined;
  try {
    logDatabaseStage(log, "sites.list", "read_sites");
    const rows = await db
      .selectFrom("sites as site")
      .leftJoin("locations as location", (join) =>
        join
          .onRef("location.id", "=", "site.location_id")
          .on("location.deactivated_at", "is", null),
      )
      .select([
        "site.id as id",
        "site.name as name",
        "site.is_public as is_public",
        "location.geometry as location_geometry",
      ])
      .where("site.deactivated_at", "is", null)
      .orderBy("site.name")
      .orderBy("site.id")
      .execute();
    const response = rows.map((row) => ({
      id: row.id,
      name: row.name,
      is_public: row.is_public,
      position: position(row.location_geometry),
    }));
    log("sites.list.completed", {
      row_count: response.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies SiteListResponse[];
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "sites.list.failed",
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

export async function getSite(
  db: Kysely<Database>,
  id: string,
  log: RequestLog,
) {
  const started = performance.now();
  log("sites.get.started", { site_id: id });
  log.databaseStage = undefined;
  try {
    const response = await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .execute(async (trx) => {
        await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
          trx,
        );

        return await siteDetail(trx, id, log, "site.get");
      });
    if (!response) {
      log("sites.get.not_found", { site_id: id }, "warn");
      throw new HttpError(404, "not_found", "Site not found.", {
        reason: "site_not_found",
      });
    }
    log("sites.get.completed", {
      site_id: id,
      event_count: response.planting_events.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies SiteResponse;
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "sites.get.failed",
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

export async function createSite(
  db: Kysely<Database>,
  body: SiteCreateRequest,
  log: RequestLog,
) {
  const id = generateUniqueID(IdPrefixes.SITE);
  const locationId = body.location
    ? generateUniqueID(IdPrefixes.LOCATION)
    : null;
  const started = performance.now();
  log("sites.create.started", { site_id: id, actor_id: DEVELOPMENT_ACTOR_ID });
  log.databaseStage = undefined;
  try {
    const response = await db.transaction().execute(async (trx) => {
      await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
        trx,
      );

      await requireAuditActor(trx, "site.create", log);
      const location = body.location;
      if (location && locationId) {
        const geometry = storedGeometry(location.geometry);
        logDatabaseStage(log, "site.create", "save_location");
        await trx
          .insertInto("locations")
          .values({
            id: locationId,
            geometry,
            created_by: DEVELOPMENT_ACTOR_ID,
            updated_by: DEVELOPMENT_ACTOR_ID,
          })
          .execute();
      }
      logDatabaseStage(log, "site.create", "save_site");
      await trx
        .insertInto("sites")
        .values({
          id,
          name: body.name,
          description: body.description,
          is_public: body.is_public,
          location_id: locationId,
          created_by: DEVELOPMENT_ACTOR_ID,
          updated_by: DEVELOPMENT_ACTOR_ID,
        })
        .execute();
      const saved = await siteDetail(trx, id, log, "site.create");
      if (!saved) {
        log("sites.create.empty_result", { site_id: id }, "error");
        throw new HttpError(
          500,
          "internal_error",
          "The request could not be completed.",
        );
      }
      return saved;
    });
    log("sites.create.completed", {
      site_id: id,
      event_count: response.planting_events.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies SiteResponse;
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "sites.create.failed",
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

export async function updateSite(
  db: Kysely<Database>,
  id: string,
  body: SiteUpdateRequest,
  log: RequestLog,
) {
  const started = performance.now();
  log("sites.update.started", { site_id: id, actor_id: DEVELOPMENT_ACTOR_ID });
  log.databaseStage = undefined;
  try {
    const response = await db.transaction().execute(async (trx) => {
      await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
        trx,
      );

      await requireAuditActor(trx, "site.update", log);
      logDatabaseStage(log, "site.update", "read_site");
      const saved = await trx
        .selectFrom("sites")
        .select(["location_id"])
        .where("id", "=", id)
        .where("deactivated_at", "is", null)
        .executeTakeFirst();
      if (!saved) {
        throw new HttpError(404, "not_found", "Site not found.", {
          reason: "site_not_found",
        });
      }

      const changedAt = sql<Date>`now()`;
      logDatabaseStage(log, "site.update", "save_location");
      const locationId = await saveSiteLocation(
        trx,
        saved.location_id,
        body.location,
      );
      logDatabaseStage(log, "site.update", "save_site");
      await trx
        .updateTable("sites")
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
      const detail = await siteDetail(trx, id, log, "site.update");
      if (!detail) {
        log("sites.update.empty_result", { site_id: id }, "error");
        throw new HttpError(
          500,
          "internal_error",
          "The request could not be completed.",
        );
      }
      return detail;
    });
    log("sites.update.completed", {
      site_id: id,
      event_count: response.planting_events.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies SiteResponse;
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "sites.update.failed",
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

export async function deactivateSite(
  db: Kysely<Database>,
  id: string,
  log: RequestLog,
) {
  const started = performance.now();
  log("sites.deactivate.started", {
    site_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
  });
  log.databaseStage = undefined;
  try {
    await db.transaction().execute(async (trx) => {
      await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
        trx,
      );

      await requireAuditActor(trx, "site.deactivate", log);
      logDatabaseStage(log, "site.deactivate", "read_site");
      const saved = await trx
        .selectFrom("sites")
        .select(["location_id", "deactivated_at"])
        .where("id", "=", id)
        .executeTakeFirst();
      if (!saved) {
        throw new HttpError(404, "not_found", "Site not found.", {
          reason: "site_not_found",
        });
      }
      if (saved.deactivated_at !== null) {
        log("sites.deactivate.already_inactive", { site_id: id });
        return;
      }
      const changedAt = sql<Date>`now()`;
      if (saved.location_id !== null) {
        const locationId = saved.location_id;
        logDatabaseStage(log, "site.deactivate", "deactivate_location");
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
      logDatabaseStage(log, "site.deactivate", "deactivate_site");
      await trx
        .updateTable("sites")
        .set({
          deactivated_at: changedAt,
          updated_at: changedAt,
          updated_by: DEVELOPMENT_ACTOR_ID,
        })
        .where("id", "=", id)
        .where("deactivated_at", "is", null)
        .execute();
    });
    log("sites.deactivate.completed", {
      site_id: id,
      duration_ms: Math.round(performance.now() - started),
    });
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "sites.deactivate.failed",
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

async function saveSiteLocation(
  trx: Transaction<Database>,
  existingId: string | null,
  input: SiteUpdateRequest["location"],
) {
  const changedAt = sql<Date>`now()`;
  if (input === null) {
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
    return null satisfies string | null;
  }
  const geometry = storedGeometry(input.geometry);
  if (existingId !== null) {
    await trx
      .updateTable("locations")
      .set({
        geometry,
        updated_at: changedAt,
        updated_by: DEVELOPMENT_ACTOR_ID,
      })
      .where("id", "=", existingId)
      .execute();
    return existingId satisfies string | null;
  }
  const id = generateUniqueID(IdPrefixes.LOCATION);
  await trx
    .insertInto("locations")
    .values({
      id,
      geometry,
      created_by: DEVELOPMENT_ACTOR_ID,
      updated_by: DEVELOPMENT_ACTOR_ID,
    })
    .execute();
  return id satisfies string | null;
}
