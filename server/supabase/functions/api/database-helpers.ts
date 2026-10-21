import type { Transaction } from "kysely";
import type { Geometry } from "@wrt/api-types";
import type { Database } from "./database.schema.ts";
import { DEVELOPMENT_ACTOR_ID } from "./config.ts";
import { HttpError } from "./http.ts";
import { logDatabaseStage } from "./logging.ts";
import type { RequestLog } from "./logging.ts";

export async function requireAuditActor(
  trx: Transaction<Database>,
  operation: string,
  log: RequestLog,
) {
  logDatabaseStage(log, operation, "audit_actor");
  const actor = await trx
    .selectFrom("users")
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
}

export function safeInteger(value: number | string | bigint) {
  const integer = BigInt(value);
  if (integer < 0n || integer > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(
      409,
      "conflict",
      "The combined planting total exceeds the supported integer range.",
      { reason: "aggregate_out_of_range" },
    );
  }
  return Number(integer) satisfies number;
}

export function dateString(value: Date | string) {
  return (
    value instanceof Date ? value.toISOString().slice(0, 10) : value
  ) satisfies string;
}

export async function readLocation(
  trx: Transaction<Database>,
  id: string | null,
  operation: string,
  log: RequestLog,
) {
  if (id === null) return null;
  logDatabaseStage(log, operation, "read_location");
  return (
    (await trx
      .selectFrom("locations")
      .select(["id", "geometry"])
      .where("id", "=", id)
      .where("deactivated_at", "is", null)
      .executeTakeFirst()) ?? null
  );
}

export function storedGeometry(geometry: Geometry) {
  // The shared HTTP contract allows polygons, while the current table constraint
  // intentionally stores Point geometries only and returns validation errors.
  return geometry as Database["locations"]["geometry"] satisfies Database["locations"]["geometry"];
}
