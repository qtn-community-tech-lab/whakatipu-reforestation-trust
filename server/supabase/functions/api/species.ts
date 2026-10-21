import { sql } from "kysely";
import type { Kysely, Selectable, Transaction } from "kysely";
import type {
  SpeciesCreateRequest,
  SpeciesListResponse,
  SpeciesResponse,
  SpeciesUpdateRequest,
} from "@wrt/api-types";
import type { Database, SpeciesTable } from "./database.schema.ts";
import { generateUniqueID, IdPrefixes } from "../_shared/ids.ts";
import { DEVELOPMENT_ACTOR_ID } from "./config.ts";
import {
  databaseStage,
  requireAuditActor,
  safeInteger,
} from "./database-helpers.ts";
import { HttpError } from "./http.ts";
import { withTransaction } from "./database.ts";
import type { RequestLog } from "./logging.ts";
import { readEventSummaries } from "./event-data.ts";

function speciesListResponse(
  row: Selectable<SpeciesTable>,
): SpeciesListResponse {
  return {
    id: row.id,
    scientific_name: row.scientific_name,
    common_name: row.common_name,
    image_url: row.image_url,
    aliases: row.aliases,
    is_public: row.is_public,
  };
}

async function speciesDetail(
  trx: Transaction<Database>,
  id: string,
  log: RequestLog,
  operation: string,
): Promise<SpeciesResponse | null> {
  const species = await databaseStage(
    operation,
    "read_species",
    log,
    () =>
      trx.selectFrom("species")
        .selectAll()
        .where("id", "=", id)
        .where("deactivated_at", "is", null)
        .executeTakeFirst(),
  );
  if (!species) return null;

  const events = await readEventSummaries(trx, operation, log, {
    species_id: id,
  });
  const quantity = await databaseStage(
    operation,
    "read_species_total",
    log,
    () =>
      trx.selectFrom("planting_event_species as line")
        .innerJoin(
          "planting_events as event",
          "event.id",
          "line.planting_event_id",
        )
        .innerJoin("sites as site", "site.id", "event.site_id")
        .select((eb) => eb.fn.sum<string | null>("line.quantity").as("total"))
        .where("line.species_id", "=", id)
        .where("line.deactivated_at", "is", null)
        .where("event.deactivated_at", "is", null)
        .where("site.deactivated_at", "is", null)
        .executeTakeFirstOrThrow(),
  );
  const totals = await databaseStage(
    operation,
    "check_species_total",
    log,
    () => ({
      planting_event_count: events.length,
      total_plants: safeInteger(quantity.total ?? "0"),
    }),
  );
  return {
    ...speciesListResponse(species),
    description: species.description,
    created_at: species.created_at.toISOString(),
    updated_at: species.updated_at.toISOString(),
    totals,
    planting_events: events,
  };
}

export async function listSpecies(
  db: Kysely<Database>,
  log: RequestLog,
): Promise<SpeciesListResponse[]> {
  const started = performance.now();
  log("species.list.started");
  const rows = await withTransaction(
    db,
    "species.list",
    log,
    (trx) =>
      trx.selectFrom("species")
        .selectAll()
        .where("deactivated_at", "is", null)
        .orderBy("scientific_name")
        .orderBy("id")
        .execute(),
  );
  const response = rows.map(speciesListResponse);
  log("species.list.completed", {
    row_count: response.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function getSpecies(
  db: Kysely<Database>,
  id: string,
  log: RequestLog,
): Promise<SpeciesResponse> {
  const started = performance.now();
  log("species.get.started", { species_id: id });
  const response = await withTransaction(
    db,
    "species.get",
    log,
    (trx) => speciesDetail(trx, id, log, "species.get"),
    "repeatable read",
  );
  if (!response) {
    log("species.get.not_found", { species_id: id }, "warn");
    throw new HttpError(404, "not_found", "Species not found.", {
      reason: "species_not_found",
    });
  }
  log("species.get.completed", {
    species_id: id,
    event_count: response.planting_events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

function editableFields(body: SpeciesCreateRequest | SpeciesUpdateRequest) {
  return {
    scientific_name: body.scientific_name,
    common_name: body.common_name,
    aliases: body.aliases,
    description: body.description,
    image_url: body.image_url,
    is_public: body.is_public,
  };
}

export async function createSpecies(
  db: Kysely<Database>,
  body: SpeciesCreateRequest,
  log: RequestLog,
): Promise<SpeciesResponse> {
  const id = generateUniqueID(IdPrefixes.SPECIES);
  const started = performance.now();
  log("species.create.started", {
    species_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
  });
  const response = await withTransaction(
    db,
    "species.create",
    log,
    async (trx) => {
      await requireAuditActor(trx, "species.create", log);
      await databaseStage("species.create", "save_species", log, async () => {
        await trx.insertInto("species").values({
          id,
          ...editableFields(body),
          created_by: DEVELOPMENT_ACTOR_ID,
          updated_by: DEVELOPMENT_ACTOR_ID,
        }).execute();
      });
      const saved = await speciesDetail(trx, id, log, "species.create");
      if (!saved) {
        log("species.create.empty_result", { species_id: id }, "error");
        throw new HttpError(
          500,
          "internal_error",
          "The request could not be completed.",
        );
      }
      return saved;
    },
  );
  log("species.create.completed", {
    species_id: id,
    event_count: response.planting_events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function updateSpecies(
  db: Kysely<Database>,
  id: string,
  body: SpeciesUpdateRequest,
  log: RequestLog,
): Promise<SpeciesResponse> {
  const started = performance.now();
  log("species.update.started", {
    species_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
  });
  const response = await withTransaction(
    db,
    "species.update",
    log,
    async (trx) => {
      await requireAuditActor(trx, "species.update", log);
      const saved = await databaseStage(
        "species.update",
        "read_species",
        log,
        () =>
          trx.selectFrom("species")
            .select(["id"])
            .where("id", "=", id)
            .where("deactivated_at", "is", null)
            .executeTakeFirst(),
      );
      if (!saved) {
        throw new HttpError(404, "not_found", "Species not found.", {
          reason: "species_not_found",
        });
      }
      await databaseStage("species.update", "save_species", log, async () => {
        await trx.updateTable("species")
          .set({
            ...editableFields(body),
            updated_by: DEVELOPMENT_ACTOR_ID,
            updated_at: sql<Date>`now()`,
          })
          .where("id", "=", id)
          .execute();
      });
      const detail = await speciesDetail(trx, id, log, "species.update");
      if (!detail) {
        log("species.update.empty_result", { species_id: id }, "error");
        throw new HttpError(
          500,
          "internal_error",
          "The request could not be completed.",
        );
      }
      return detail;
    },
  );
  log("species.update.completed", {
    species_id: id,
    event_count: response.planting_events.length,
    duration_ms: Math.round(performance.now() - started),
  });
  return response;
}

export async function deactivateSpecies(
  db: Kysely<Database>,
  id: string,
  log: RequestLog,
): Promise<void> {
  const started = performance.now();
  log("species.deactivate.started", {
    species_id: id,
    actor_id: DEVELOPMENT_ACTOR_ID,
  });
  await withTransaction(db, "species.deactivate", log, async (trx) => {
    await requireAuditActor(trx, "species.deactivate", log);
    const saved = await databaseStage(
      "species.deactivate",
      "read_species",
      log,
      () =>
        trx.selectFrom("species")
          .select(["deactivated_at"])
          .where("id", "=", id)
          .executeTakeFirst(),
    );
    if (!saved) {
      throw new HttpError(404, "not_found", "Species not found.", {
        reason: "species_not_found",
      });
    }
    if (saved.deactivated_at !== null) {
      log("species.deactivate.already_inactive", { species_id: id });
      return;
    }
    await databaseStage(
      "species.deactivate",
      "deactivate_species",
      log,
      async () => {
        const now = sql<Date>`now()`;
        await trx.updateTable("species")
          .set({
            deactivated_at: now,
            updated_at: now,
            updated_by: DEVELOPMENT_ACTOR_ID,
          })
          .where("id", "=", id)
          .where("deactivated_at", "is", null)
          .execute();
      },
    );
  });
  log("species.deactivate.completed", {
    species_id: id,
    duration_ms: Math.round(performance.now() - started),
  });
}
