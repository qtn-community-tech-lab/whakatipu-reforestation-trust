import type { ErrorResponse } from "@wrt/api-types";
import type { RequestLog } from "./logging.ts";

type ErrorCode = ErrorResponse["error"]["code"];

export class HttpError extends Error {
  constructor(
    public readonly status: 400 | 404 | 405 | 409 | 500,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function throwDatabaseError(
  error: { code: string },
  log: RequestLog,
  started: number,
): never {
  // Database messages/details can contain supplied values; log the code only.
  log("database.failed", {
    database_code: error.code,
    duration_ms: Math.round(performance.now() - started),
  }, "error");
  if (error.code === "PT404") {
    throw new HttpError(404, "not_found", "Record not found.");
  }
  if (["PT409", "23505", "23503"].includes(error.code)) {
    throw new HttpError(
      409,
      "conflict",
      "The operation conflicts with the stored data.",
    );
  }
  if (["23514", "23502", "22P02", "22023"].includes(error.code)) {
    throw new HttpError(
      400,
      "validation_error",
      "The database could not accept the supplied values.",
    );
  }
  throw new HttpError(
    500,
    "internal_error",
    "The request could not be completed.",
  );
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new HttpError(
        400,
        "validation_error",
        "The request body must be valid JSON.",
      );
    }
    throw error;
  }
}
