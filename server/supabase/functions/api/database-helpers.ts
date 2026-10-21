import type { Transaction } from "kysely";
import type { Geometry } from "@wrt/api-types";
import type { Database } from "./database.schema.ts";
import { DEVELOPMENT_ACTOR_ID } from "./config.ts";
import { HttpError } from "./http.ts";
import type { RequestLog } from "./logging.ts";

export async function databaseStage<T>(
  operation: string,
  stage: string,
  log: RequestLog,
  work: () => T | PromiseLike<T>,
): Promise<T> {
  const started = performance.now();
  log.databaseStage = stage;
  log("database.stage.started", { database_operation: operation, stage });
  const result = await work();
  log("database.stage.completed", {
    database_operation: operation,
    stage,
    duration_ms: Math.round(performance.now() - started),
  });
  return result;
}

export async function requireAuditActor(
  trx: Transaction<Database>,
  operation: string,
  log: RequestLog,
): Promise<void> {
  await databaseStage(
    operation,
    "audit_actor",
    log,
    async () => {
      const actor = await trx.selectFrom("users")
        .select("id")
        .where("id", "=", DEVELOPMENT_ACTOR_ID)
        .where("deactivated_at", "is", null)
        .executeTakeFirst();
      if (!actor) {
        throw new HttpError(
          500,
          "internal_error",
          "The account used by the server to save changes is unavailable.",
          { reason: "audit_actor_unavailable" },
        );
      }
    },
  );
}

export function safeInteger(value: number | string | bigint): number {
  const integer = BigInt(value);
  if (integer < 0n || integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(
      409,
      "conflict",
      "The combined planting total exceeds the supported integer range.",
      { reason: "aggregate_out_of_range" },
    );
  }
  return Number(integer);
}

export function dateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

export async function readLocation(
  trx: Transaction<Database>,
  id: string | null,
  operation: string,
  log: RequestLog,
) {
  if (id === null) return null;
  return await databaseStage(
    operation,
    "read_location",
    log,
    async () =>
      await trx.selectFrom("locations")
        .select(["id", "geometry"])
        .where("id", "=", id)
        .where("deactivated_at", "is", null)
        .executeTakeFirst() ?? null,
  );
}

export function storedGeometry(
  geometry: Geometry,
): Database["locations"]["geometry"] {
  // The shared HTTP contract allows polygons, while the current table constraint
  // intentionally stores Point geometries only and returns validation errors.
  return geometry as Database["locations"]["geometry"];
}
