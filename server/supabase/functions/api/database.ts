import { PostgresJSDialect } from "kysely-postgres-js";
import { Kysely, sql } from "kysely";
import type { Transaction } from "kysely";
import postgres from "postgres";
import type { Database } from "./database.schema.ts";
import { HttpError } from "./http.ts";
import { exceptionLogFields } from "./logging.ts";
import type { RequestLog } from "./logging.ts";

let database: Kysely<Database> | undefined;

export function getDatabase(): Kysely<Database> {
  if (database) return database;
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
  return database;
}

interface DatabaseError {
  code: string;
  constraint?: string;
  table?: string;
  column?: string;
}

function asDatabaseError(error: unknown): DatabaseError | undefined {
  if (error instanceof HttpError) return undefined;
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const source = error as Record<string, unknown>;
  if (typeof source.code !== "string") return undefined;
  return {
    code: source.code,
    constraint: typeof source.constraint_name === "string"
      ? source.constraint_name
      : undefined,
    table: typeof source.table_name === "string"
      ? source.table_name
      : undefined,
    column: typeof source.column_name === "string"
      ? source.column_name
      : undefined,
  };
}

export function databaseHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const code = asDatabaseError(error)?.code;
  if (code === "23505" || code === "23503") {
    return new HttpError(
      409,
      "conflict",
      "The operation conflicts with the stored data.",
      {
        reason: code === "23505"
          ? "duplicate_record"
          : "referenced_record_unavailable",
        cause: error,
      },
    );
  }
  if (
    code && [
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
    );
  }
  return new HttpError(
    500,
    "internal_error",
    "The request could not be completed.",
    { cause: error },
  );
}

export async function withTransaction<T>(
  db: Kysely<Database>,
  operation: string,
  log: RequestLog,
  work: (trx: Transaction<Database>) => Promise<T>,
  isolationLevel?: "repeatable read",
): Promise<T> {
  log.databaseStage = undefined;
  const started = performance.now();
  log("database.started", { database_operation: operation });
  try {
    const transaction = db.transaction();
    const configured = isolationLevel
      ? transaction.setIsolationLevel(isolationLevel)
      : transaction;
    const result = await configured.execute(async (trx) => {
      await setRequestContext(trx, log);
      return await work(trx);
    });
    log("database.completed", {
      database_operation: operation,
      duration_ms: Math.round(performance.now() - started),
    });
    return result;
  } catch (error) {
    const failure = databaseHttpError(error);
    const databaseError = asDatabaseError(error);
    log(
      databaseError || error instanceof HttpError
        ? "database.failed"
        : "database.exception",
      {
        database_operation: operation,
        stage: log.databaseStage ?? null,
        database_code: databaseError?.code ?? null,
        database_constraint: databaseError?.constraint ?? null,
        database_table: databaseError?.table ?? null,
        database_column: databaseError?.column ?? null,
        error_code: failure.code,
        reason: failure.reason,
        ...exceptionLogFields(failure),
        duration_ms: Math.round(performance.now() - started),
      },
      "error",
    );
    throw failure;
  }
}

async function setRequestContext(
  trx: Transaction<Database>,
  log: RequestLog,
): Promise<void> {
  await sql`select set_config('application_name', ${`wrt-api:${log.requestId}`}, true)`
    .execute(trx);
}
