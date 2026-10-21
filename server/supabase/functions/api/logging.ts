export type LogFields = Record<string, string | number | boolean | null>;
type LogLevel = "info" | "warn" | "error";

export type RequestLog = ((
  event: string,
  fields?: LogFields,
  level?: LogLevel,
) => void) & { requestId: string; databaseStage?: string };

export function logDatabaseStage(
  log: RequestLog,
  operation: string,
  stage: string,
) {
  log.databaseStage = stage;
  log("database.stage", { database_operation: operation, stage });
}

export function exceptionLogFields(error: unknown) {
  const fields: LogFields = {};
  const seen = new Set<Error>();
  const hasExceptionStack = error instanceof Error;
  let current: unknown = hasExceptionStack ? error : new Error();
  fields.error_stack_source = hasExceptionStack
    ? "exception"
    : "logging_boundary";
  let depth = 0;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const prefix = depth === 0 ? "error" : `cause_${depth}`;
    fields[`${prefix}_type`] = current.name;
    // Keep every stack frame, excluding the error message, which can echo input.
    // Strip URL credentials/query strings/fragments from frame locations too.
    fields[`${prefix}_stack`] =
      current.stack
        ?.replace(current.message, "")
        .split("\n")
        .filter((line) => /^\s*at\s/.test(line))
        .map((line) =>
          line.replace(/https?:\/\/[^\s)]+/g, (location) => {
            try {
              const url = new URL(location);
              url.username = "";
              url.password = "";
              url.search = "";
              url.hash = "";
              return url.toString();
            } catch {
              return "[unavailable frame location]";
            }
          }),
        )
        .join("\n") || null;
    current = current.cause;
    depth += 1;
  }
  if (!hasExceptionStack) fields.error_type = "UnknownError";
  return fields satisfies LogFields;
}

export function createRequestLog(
  requestId: string,
  method: string,
  path: string,
) {
  const write = (
    event: string,
    fields: LogFields = {},
    level: LogLevel = "info",
  ) => {
    console[level](
      JSON.stringify({
        ...fields,
        timestamp: new Date().toISOString(),
        level,
        event,
        request_id: requestId,
        method,
        path,
      }),
    );
  };
  return Object.assign(write, { requestId }) satisfies RequestLog;
}
