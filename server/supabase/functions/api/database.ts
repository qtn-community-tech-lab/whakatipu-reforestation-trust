import { throwDatabaseError } from "./http.ts";
import type { RequestLog } from "./logging.ts";

type DatabaseResult<T> =
  | { data: T; error: null }
  | { data: null; error: { code: string } };

// Keep the SDK's typed query/result at each call site, but handle every database
// boundary consistently, including exceptions that do not arrive as SDK errors.
export async function queryDatabase<T>(
  operation: string,
  log: RequestLog,
  execute: () => PromiseLike<DatabaseResult<T>>,
): Promise<T> {
  const started = performance.now();
  log("database.started", { database_operation: operation });
  let result: DatabaseResult<T>;
  try {
    result = await execute();
  } catch (error) {
    // Error messages, causes and stacks can contain URLs or supplied values.
    log("database.exception", {
      database_operation: operation,
      error_type: error instanceof Error ? error.name : "UnknownError",
      duration_ms: Math.round(performance.now() - started),
    }, "error");
    throw error;
  }
  if (result.error) {
    throwDatabaseError(result.error, log, started, operation);
  }
  log("database.completed", {
    database_operation: operation,
    duration_ms: Math.round(performance.now() - started),
  });
  return result.data;
}
