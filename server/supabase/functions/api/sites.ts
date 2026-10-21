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
  databaseStage,
  readLocation,
  requireAuditActor,
  storedGeometry,
} from "./database-helpers.ts";
import { readEventCollection } from "./event-data.ts";
import { HttpError } from "./http.ts";
import { withTransaction } from "./database.ts";
import type { RequestLog } from "./logging.ts";
import { position } from "./responses.ts";

async function siteDetail(
  trx: Transaction<Database>,
  id: string,
  log: RequestLog,
  operation: string,
): Promise<SiteResponse | null> {
  const row = await databaseStage(
    operation,
    "read_site",
    log,
    () =>
      trx.selectFrom("sites").selectAll()
        .where("id", "=", id)
        .where("deactivated_at", "is", null)
        .executeTakeFirst(),
  );
  if (!row) return null;

  const areas = await databaseStage(
    operation,
    "read_areas",
    log,
    () =>
      trx.selectFrom("planting_areas as area")
        .leftJoin(
          "locations as location",
          (join) =>
            join.onRef("location.id", "=", "area.location_id")
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
        .execute(),
  );
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
  };
}

export async function listSites(
  db: Kysely<Database>,
  log: RequestLog,
): Promise<SiteListResponse[]> {
  const started = performance.now();
  log("sites.list.started");
  const rows = await withTransaction(
    db,
    "sites.list",
    log,
    (trx) =>
      trx.selectFrom("sites as site")
        .leftJoin(
          "locations as location",
          (join) =>
            join.onRef("location.id", "=", "site.location_id")
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
        .execute(),
  );
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
  return response;
}

export async function getSite(
  db: Kysely<Database>,
  id: string,
  log: RequestLog,
): Promise<SiteResponse> {
  const started = performance.now();
  log("sites.get.started", { site_id: id });
  const response = await withTransaction(
    db,
    "site.get",
    log,
    (trx) => siteDetail(trx, id, log, "site.get"),
    "repeatable read",
  );
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
  return response;
}

export async function createSite(
  db: Kysely<Database>,
  body: SiteCreateRequest,
  log: RequestLog,
): Promise<SiteResponse> {
  const id = generateUniqueID(IdPrefixes.SITE);
  const locationId = body.location
    ? generateUniqueID(IdPrefixes.LOCATION)
    : null;
  const started = performance.now();
  log("sites.create.started", { site_id: id, actor_id: DEVELOPMENT_ACTOR_ID });
  const response = await withTransaction(
    db,
    "site.create",
    log,
    async (trx) => {
      await requireAuditActor(trx, "site.create", log);
      const location = body.location;
      if (location && locationId) {
        const geometry = storedGeometry(location.geometry);
        await databaseStage("site.create", "save_location", log, async () => {
          await trx.insertInto("locations").values({
            id: locationId,
            geometry,
            created_by: DEVELOPMENT_ACTOR_ID,
            updated_by: DEVELOPMENT_ACTOR_ID,
          }).execute();
        });
      }
      await databaseStage("site.create", "save_site", log, async () => {
        await trx.insertInto("sites").values({
          id,
          name: body.name,
          description: body.description,
          is_public: body.is_public,
          location_id: locationId,
          created_by: DEVELOPMENT_ACTOR_ID,
          updated_by: DEVELOPMENT_ACTOR_ID,
        }).execute();
      });
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
    },
  );
  log("sites.create.completed", {
    site_id: id,
    event_count: response.planting_events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function updateSite(
  db: Kysely<Database>,
  id: string,
  body: SiteUpdateRequest,
  log: RequestLog,
): Promise<SiteResponse> {
  const started = performance.now();
  log("sites.update.started", { site_id: id, actor_id: DEVELOPMENT_ACTOR_ID });
  const response = await withTransaction(
    db,
    "site.update",
    log,
    async (trx) => {
      await requireAuditActor(trx, "site.update", log);
      const saved = await databaseStage(
        "site.update",
        "read_site",
        log,
        () =>
          trx.selectFrom("sites")
            .select(["location_id"])
            .where("id", "=", id)
            .where("deactivated_at", "is", null)
            .executeTakeFirst(),
      );
      if (!saved) {
        throw new HttpError(404, "not_found", "Site not found.", {
          reason: "site_not_found",
        });
      }

      const changedAt = sql<Date>`now()`;
      const locationId = await databaseStage(
        "site.update",
        "save_location",
        log,
        async () => {
          if (body.location === null) {
            if (saved.location_id !== null) {
              await trx.updateTable("locations")
                .set({
                  deactivated_at: changedAt,
                  updated_at: changedAt,
                  updated_by: DEVELOPMENT_ACTOR_ID,
                })
                .where("id", "=", saved.location_id)
                .where("deactivated_at", "is", null)
                .execute();
            }
            return null;
          }
          const geometry = storedGeometry(body.location.geometry);
          if (saved.location_id !== null) {
            await trx.updateTable("locations")
              .set({
                geometry,
                updated_at: changedAt,
                updated_by: DEVELOPMENT_ACTOR_ID,
              })
              .where("id", "=", saved.location_id)
              .execute();
            return saved.location_id;
          }
          const id = generateUniqueID(IdPrefixes.LOCATION);
          await trx.insertInto("locations").values({
            id,
            geometry,
            created_by: DEVELOPMENT_ACTOR_ID,
            updated_by: DEVELOPMENT_ACTOR_ID,
          }).execute();
          return id;
        },
      );
      await databaseStage("site.update", "save_site", log, async () => {
        await trx.updateTable("sites")
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
      });
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
    },
  );
  log("sites.update.completed", {
    site_id: id,
    event_count: response.planting_events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function deactivateSite(
  db: Kysely<Database>,
  id: string,
  log: RequestLog,
): Promise<void> {
  const started = performance.now();
  log("sites.deactivate.started", {
    site_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
  });
  await withTransaction(db, "site.deactivate", log, async (trx) => {
    await requireAuditActor(trx, "site.deactivate", log);
    const saved = await databaseStage(
      "site.deactivate",
      "read_site",
      log,
      () =>
        trx.selectFrom("sites").select(["location_id", "deactivated_at"])
          .where("id", "=", id).executeTakeFirst(),
    );
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
      await databaseStage(
        "site.deactivate",
        "deactivate_location",
        log,
        async () => {
          await trx.updateTable("locations")
            .set({
              deactivated_at: changedAt,
              updated_at: changedAt,
              updated_by: DEVELOPMENT_ACTOR_ID,
            })
            .where("id", "=", locationId)
            .where("deactivated_at", "is", null)
            .execute();
        },
      );
    }
    await databaseStage("site.deactivate", "deactivate_site", log, async () => {
      await trx.updateTable("sites")
        .set({
          deactivated_at: changedAt,
          updated_at: changedAt,
          updated_by: DEVELOPMENT_ACTOR_ID,
        })
        .where("id", "=", id)
        .where("deactivated_at", "is", null)
        .execute();
    });
  });
  log("sites.deactivate.completed", {
    site_id: id,
    duration_ms: Math.round(performance.now() - started),
  });
}
