import { PostgresJSDialect } from "kysely-postgres-js";
import { Kysely } from "kysely";
import postgres from "postgres";
import type { Database } from "./database.schema.ts";
import { HttpError } from "./http.ts";
import { exceptionLogFields } from "./logging.ts";
import type { LogFields } from "./logging.ts";

let database: Kysely<Database> | undefined;

export function getDatabase() {
  if (database) return database satisfies Kysely<Database>;
  const connectionString = Deno.env.get("SUPABASE_DB_URL");
  if (!connectionString) {
    throw new HttpError(
      500,
      "internal_error",
      "Server configuration is unavailable.",
      { reason: "server_configuration_unavailable" },
    );
  }

  database = new Kysely<Database>({
    dialect: new PostgresJSDialect({
      postgres: postgres(connectionString, {
        max: 1,
        prepare: false,
        connection: { application_name: "wrt-api" },
      }),
    }),
  });
  return database satisfies Kysely<Database>;
}

interface DatabaseError {
  code: string;
  constraint?: string;
  table?: string;
  column?: string;
}

function asDatabaseError(error: unknown) {
  if (error instanceof HttpError) {
    return undefined satisfies DatabaseError | undefined;
  }
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined satisfies DatabaseError | undefined;
  }
  const source = error as Record<string, unknown>;
  if (typeof source.code !== "string") {
    return undefined satisfies DatabaseError | undefined;
  }
  return {
    code: source.code,
    constraint:
      typeof source.constraint_name === "string"
        ? source.constraint_name
        : undefined,
    table:
      typeof source.table_name === "string" ? source.table_name : undefined,
    column:
      typeof source.column_name === "string" ? source.column_name : undefined,
  } satisfies DatabaseError | undefined;
}

export function databaseHttpError(error: unknown) {
  if (error instanceof HttpError) return error satisfies HttpError;
  const code = asDatabaseError(error)?.code;
  if (code === "23505" || code === "23503") {
    return new HttpError(
      409,
      "conflict",
      "The operation conflicts with the stored data.",
      {
        reason:
          code === "23505"
            ? "duplicate_record"
            : "referenced_record_unavailable",
        cause: error,
      },
    ) satisfies HttpError;
  }
  if (
    code &&
    [
      "23514",
      "23502",
      "22P02",
      "22P05",
      "22023",
      "22007",
      "22008",
      "22003",
    ].includes(code)
  ) {
    return new HttpError(
      400,
      "validation_error",
      "The database could not accept the supplied values.",
      { reason: "invalid_values", cause: error },
    ) satisfies HttpError;
  }
  return new HttpError(
    500,
    "internal_error",
    "The request could not be completed.",
    { cause: error },
  ) satisfies HttpError;
}

export function databaseErrorLogFields(error: unknown) {
  const original = error instanceof HttpError ? error.cause : error;
  const details = asDatabaseError(original);
  const fields: LogFields = {
    database_code: details?.code ?? null,
    database_constraint: details?.constraint ?? null,
    database_table: details?.table ?? null,
    database_column: details?.column ?? null,
    ...exceptionLogFields(error),
  };
  return fields satisfies LogFields;
}
