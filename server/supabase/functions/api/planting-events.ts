import { sql } from "kysely";
import type { Kysely, Transaction } from "kysely";
import type {
  PlantingEventCreateRequest,
  PlantingEventListResponse,
  PlantingEventResponse,
  PlantingEventUpdateRequest,
} from "@wrt/api-types";
import type { Database } from "./database.schema.ts";
import { generateUniqueID, IdPrefixes } from "../_shared/ids.ts";
import { DEVELOPMENT_ACTOR_ID } from "./config.ts";
import {
  dateString,
  readLocation,
  requireAuditActor,
  safeInteger,
} from "./database-helpers.ts";
import { readEventSummaries } from "./event-data.ts";
import { HttpError } from "./http.ts";
import { databaseErrorLogFields, databaseHttpError } from "./database.ts";
import { logDatabaseStage } from "./logging.ts";
import type { RequestLog } from "./logging.ts";

export async function createPlantingEvent(
  db: Kysely<Database>,
  request: PlantingEventCreateRequest,
  log: RequestLog,
) {
  return await savePlantingEvent(
    db,
    generateUniqueID(IdPrefixes.PLANTING_EVENT),
    request,
    true,
    log,
  );
}

async function eventDetail(
  trx: Transaction<Database>,
  id: string,
  log: RequestLog,
  operation: string,
) {
  logDatabaseStage(log, operation, "read_event");
  const event = await trx
    .selectFrom("planting_events")
    .selectAll()
    .where("id", "=", id)
    .where("deactivated_at", "is", null)
    .executeTakeFirst();
  if (!event) return null satisfies PlantingEventResponse | null;

  logDatabaseStage(log, operation, "read_site");
  const site = await trx
    .selectFrom("sites")
    .select(["id", "name", "is_public", "location_id"])
    .where("id", "=", event.site_id)
    .where("deactivated_at", "is", null)
    .executeTakeFirst();
  if (!site) return null satisfies PlantingEventResponse | null;

  // Details retain an inactive area's identity, but only active areas supply a location.
  const areaId = event.planting_area_id;
  logDatabaseStage(log, operation, "read_area");
  const area =
    areaId === null
      ? undefined
      : await trx
          .selectFrom("planting_areas")
          .select(["id", "name", "deactivated_at", "location_id"])
          .where("id", "=", areaId)
          .executeTakeFirst();
  const areaLocation =
    area?.deactivated_at === null
      ? await readLocation(trx, area.location_id, operation, log)
      : null;
  const location =
    areaLocation ?? (await readLocation(trx, site.location_id, operation, log));

  logDatabaseStage(log, operation, "read_event_species");
  const lines = await trx
    .selectFrom("planting_event_species as line")
    .innerJoin("species as catalogue", "catalogue.id", "line.species_id")
    .select([
      "line.id as id",
      "line.species_id as species_id",
      "line.quantity as quantity",
      "catalogue.scientific_name as scientific_name",
      "catalogue.common_name as common_name",
      "catalogue.image_url as image_url",
      "catalogue.deactivated_at as species_deactivated_at",
    ])
    .where("line.planting_event_id", "=", id)
    .where("line.deactivated_at", "is", null)
    .orderBy("line.species_id")
    .execute();
  logDatabaseStage(log, operation, "check_aggregates");
  const total = safeInteger(
    lines.reduce((sum, line) => sum + BigInt(line.quantity), 0n),
  );
  return {
    id: event.id,
    site: { id: site.id, name: site.name, is_public: site.is_public },
    planting_area: area
      ? {
          id: area.id,
          name: area.name,
          is_active: area.deactivated_at === null,
        }
      : null,
    planting_date: dateString(event.planting_date),
    event_type: event.event_type,
    season: event.season,
    species_ids: lines
      .filter(
        (line) =>
          BigInt(line.quantity) > 0n && line.species_deactivated_at === null,
      )
      .map((line) => line.species_id),
    total_plants: total,
    is_public: event.is_public,
    created_at: event.created_at.toISOString(),
    updated_at: event.updated_at.toISOString(),
    notes: event.notes,
    image_url: event.image_url,
    location,
    species: lines.map((line) => ({
      id: line.id,
      species: {
        id: line.species_id,
        scientific_name: line.scientific_name,
        common_name: line.common_name,
        image_url: line.image_url,
        is_active: line.species_deactivated_at === null,
      },
      quantity: safeInteger(line.quantity),
    })),
  } satisfies PlantingEventResponse | null;
}

export async function listPlantingEvents(
  db: Kysely<Database>,
  log: RequestLog,
) {
  const started = performance.now();
  log("planting_events.list.started");
  log.databaseStage = undefined;
  try {
    const response = await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .execute(async (trx) => {
        await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
          trx,
        );

        return await readEventSummaries(trx, "planting_event.list", log);
      });
    log("planting_events.list.completed", {
      row_count: response.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies PlantingEventListResponse[];
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "planting_events.list.failed",
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

export async function getPlantingEvent(
  db: Kysely<Database>,
  id: string,
  log: RequestLog,
) {
  const started = performance.now();
  log("planting_events.get.started", { planting_event_id: id });
  log.databaseStage = undefined;
  try {
    const response = await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .execute(async (trx) => {
        await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
          trx,
        );

        return await eventDetail(trx, id, log, "planting_event.get");
      });
    if (!response) {
      log("planting_events.get.not_found", { planting_event_id: id }, "warn");
      throw eventNotFound();
    }
    log("planting_events.get.completed", {
      planting_event_id: id,
      line_count: response.species.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies PlantingEventResponse;
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "planting_events.get.failed",
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

function eventNotFound() {
  return new HttpError(404, "not_found", "Planting event not found.", {
    reason: "planting_event_not_found",
  });
}

async function readEventForWrite(
  trx: Transaction<Database>,
  id: string,
  operation: string,
  log: RequestLog,
) {
  logDatabaseStage(log, operation, "read_event");
  return await trx
    .selectFrom("planting_events as event")
    .innerJoin("sites as site", "site.id", "event.site_id")
    .select(["event.site_id", "event.planting_area_id", "event.deactivated_at"])
    .where("event.id", "=", id)
    .where("site.deactivated_at", "is", null)
    .executeTakeFirst();
}

async function validateEventReferences(
  trx: Transaction<Database>,
  body: PlantingEventUpdateRequest,
  existing: { site_id: string; planting_area_id: string | null } | undefined,
  operation: string,
  log: RequestLog,
) {
  logDatabaseStage(log, operation, "check_site");
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
  const areaId = body.planting_area_id;
  if (areaId === null) return;
  logDatabaseStage(log, operation, "check_area");
  const area = await trx
    .selectFrom("planting_areas")
    .select(["site_id", "deactivated_at"])
    .where("id", "=", areaId)
    .executeTakeFirst();
  if (!area || area.site_id !== body.site_id) {
    throw new HttpError(
      409,
      "conflict",
      "The planting area is missing or does not belong to the selected site.",
      {
        reason: "area_site_mismatch",
        fields: {
          planting_area_id: "Select an area belonging to this site.",
        },
      },
    );
  }
  if (
    area.deactivated_at !== null &&
    (existing?.planting_area_id !== areaId ||
      existing?.site_id !== body.site_id)
  ) {
    throw new HttpError(
      409,
      "conflict",
      "An inactive planting area can only be kept on its existing event and site.",
      {
        reason: "inactive_area",
        fields: {
          planting_area_id:
            "Select an active area or remove the area assignment.",
        },
      },
    );
  }
}

interface DesiredCount {
  id: string;
  species_id: string;
  quantity: number;
  existing: boolean;
}

async function prepareEventCounts(
  trx: Transaction<Database>,
  id: string,
  body: PlantingEventUpdateRequest,
  operation: string,
  log: RequestLog,
) {
  const desired = body.species.map((line) => ({
    id: line.id ?? generateUniqueID(IdPrefixes.PLANTING_EVENT_SPECIES),
    species_id: line.species_id,
    quantity: line.quantity,
  }));
  logDatabaseStage(log, operation, "check_desired_counts");
  if (
    new Set(desired.map((line) => line.id)).size !== desired.length ||
    new Set(desired.map((line) => line.species_id)).size !== desired.length
  ) {
    throw new HttpError(
      409,
      "conflict",
      "Every count must have a distinct count ID and a distinct species ID.",
      {
        reason: "invalid_count_set",
        fields: {
          species: "Supply each count ID and species ID exactly once.",
        },
      },
    );
  }
  if (desired.length === 0) return [] satisfies DesiredCount[];

  logDatabaseStage(log, operation, "read_counts");
  const counts = await trx
    .selectFrom("planting_event_species")
    .select(["id", "planting_event_id", "species_id", "deactivated_at"])
    .where(
      "id",
      "in",
      desired.map((line) => line.id),
    )
    .execute();
  logDatabaseStage(log, operation, "read_species");
  const species = await trx
    .selectFrom("species")
    .select(["id", "deactivated_at"])
    .where(
      "id",
      "in",
      desired.map((line) => line.species_id),
    )
    .execute();
  const countsById = new Map(counts.map((line) => [line.id, line]));
  const speciesById = new Map(species.map((row) => [row.id, row]));
  logDatabaseStage(log, operation, "check_count_ownership_and_species");
  return desired.map((line) => {
    const existing = countsById.get(line.id);
    if (existing && existing.planting_event_id !== id) {
      throw new HttpError(
        409,
        "conflict",
        "A count ID belongs to another planting event.",
        {
          reason: "count_belongs_to_another_event",
          fields: {
            species: "Keep IDs from this event; omit IDs for new count rows.",
          },
        },
      );
    }
    const catalogue = speciesById.get(line.species_id);
    if (!catalogue) {
      throw new HttpError(
        409,
        "conflict",
        "A selected species no longer exists.",
        {
          reason: "species_unavailable",
          fields: { species: "Select an existing species for each count." },
        },
      );
    }
    if (
      catalogue.deactivated_at !== null &&
      (!existing ||
        existing.deactivated_at !== null ||
        existing.species_id !== line.species_id)
    ) {
      throw new HttpError(
        409,
        "conflict",
        "An inactive species can only be kept on its unchanged existing active count row.",
        {
          reason: "inactive_species",
          fields: {
            species:
              "Select active species for new, changed or reactivated species links.",
          },
        },
      );
    }
    return { ...line, existing: existing !== undefined };
  }) satisfies DesiredCount[];
}

async function writeEvent(
  trx: Transaction<Database>,
  id: string,
  body: PlantingEventUpdateRequest,
  create: boolean,
  operation: string,
  log: RequestLog,
) {
  logDatabaseStage(log, operation, "save_event");
  const fields = {
    site_id: body.site_id,
    planting_area_id: body.planting_area_id,
    planting_date: body.planting_date,
    event_type: body.event_type,
    season: body.season,
    notes: body.notes,
    image_url: body.image_url,
    is_public: body.is_public,
    updated_at: sql<Date>`now()`,
    updated_by: DEVELOPMENT_ACTOR_ID,
  };
  if (create) {
    await trx
      .insertInto("planting_events")
      .values({
        id,
        ...fields,
        created_by: DEVELOPMENT_ACTOR_ID,
      })
      .execute();
  } else {
    await trx
      .updateTable("planting_events")
      .set(fields)
      .where("id", "=", id)
      .execute();
  }
}

async function replaceEventCounts(
  trx: Transaction<Database>,
  id: string,
  desired: DesiredCount[],
  operation: string,
  log: RequestLog,
) {
  const changedAt = sql<Date>`now()`;
  // Clear active pairs first so existing line IDs can swap species safely.
  logDatabaseStage(log, operation, "deactivate_previous_counts");
  await trx
    .updateTable("planting_event_species")
    .set({
      deactivated_at: changedAt,
      updated_at: changedAt,
      updated_by: DEVELOPMENT_ACTOR_ID,
    })
    .where("planting_event_id", "=", id)
    .where("deactivated_at", "is", null)
    .execute();
  for (const line of desired) {
    logDatabaseStage(log, operation, "save_count");
    const fields = {
      species_id: line.species_id,
      quantity: line.quantity,
      deactivated_at: null,
      updated_at: changedAt,
      updated_by: DEVELOPMENT_ACTOR_ID,
    };
    if (line.existing) {
      await trx
        .updateTable("planting_event_species")
        .set(fields)
        .where("id", "=", line.id)
        .where("planting_event_id", "=", id)
        .execute();
    } else {
      await trx
        .insertInto("planting_event_species")
        .values({
          id: line.id,
          planting_event_id: id,
          ...fields,
          created_by: DEVELOPMENT_ACTOR_ID,
        })
        .execute();
    }
  }
}

export async function savePlantingEvent(
  db: Kysely<Database>,
  id: string,
  body: PlantingEventCreateRequest | PlantingEventUpdateRequest,
  create: boolean,
  log: RequestLog,
) {
  const started = performance.now();
  const operationName = create ? "create" : "update";
  const operation = `planting_event.${operationName}`;
  log(`planting_events.${operationName}.started`, {
    planting_event_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
  });
  log.databaseStage = undefined;
  try {
    const response = await db.transaction().execute(async (trx) => {
      await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
        trx,
      );

      await requireAuditActor(trx, operation, log);
      const existing = create
        ? undefined
        : await readEventForWrite(trx, id, operation, log);
      if (!create && (!existing || existing.deactivated_at !== null)) {
        throw eventNotFound();
      }
      await validateEventReferences(trx, body, existing, operation, log);
      const counts = await prepareEventCounts(trx, id, body, operation, log);
      await writeEvent(trx, id, body, create, operation, log);
      await replaceEventCounts(trx, id, counts, operation, log);
      const detail = await eventDetail(trx, id, log, operation);
      if (!detail) {
        log(
          `planting_events.${operationName}.empty_result`,
          {
            planting_event_id: id,
          },
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
    log(`planting_events.${operationName}.completed`, {
      planting_event_id: id,
      line_count: response.species.length,
      duration_ms: Math.round(performance.now() - started),
    });
    return response satisfies PlantingEventResponse;
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      `planting_events.${operationName}.failed`,
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

export async function deactivatePlantingEvent(
  db: Kysely<Database>,
  id: string,
  log: RequestLog,
) {
  const started = performance.now();
  log("planting_events.deactivate.started", {
    planting_event_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
  });
  log.databaseStage = undefined;
  try {
    await db.transaction().execute(async (trx) => {
      await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`.execute(
        trx,
      );

      await requireAuditActor(trx, "planting_event.deactivate", log);
      const event = await readEventForWrite(
        trx,
        id,
        "planting_event.deactivate",
        log,
      );
      if (!event) throw eventNotFound();
      if (event.deactivated_at !== null) {
        log("planting_events.deactivate.already_inactive", {
          planting_event_id: id,
        });
        return;
      }
      logDatabaseStage(log, "planting_event.deactivate", "deactivate_event");
      await trx
        .updateTable("planting_events")
        .set({
          deactivated_at: sql<Date>`now()`,
          updated_at: sql<Date>`now()`,
          updated_by: DEVELOPMENT_ACTOR_ID,
        })
        .where("id", "=", id)
        .where("deactivated_at", "is", null)
        .execute();
    });
    log("planting_events.deactivate.completed", {
      planting_event_id: id,
      duration_ms: Math.round(performance.now() - started),
    });
  } catch (error) {
    const failure = databaseHttpError(error);
    log(
      "planting_events.deactivate.failed",
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
