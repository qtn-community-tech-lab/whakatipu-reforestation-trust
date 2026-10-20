import type { ErrorResponse } from "@wrt/api-types";
import { exceptionLogFields } from "./logging.ts";
import type { RequestLog } from "./logging.ts";

type ErrorCode = ErrorResponse["error"]["code"];
type ErrorStatus = 400 | 404 | 405 | 409 | 500;

export interface DatabaseError {
  code: string;
  hint?: string | null;
}

export class HttpError extends Error {
  public readonly reason: string;
  public readonly fields: Record<string, string> | undefined;

  constructor(
    public readonly status: ErrorStatus,
    public readonly code: ErrorCode,
    message: string,
    options: {
      reason?: string;
      fields?: Record<string, string>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "HttpError";
    this.reason = options.reason ?? code;
    this.fields = options.fields;
  }
}

type DatabaseFailure = {
  databaseCode: string;
  status: ErrorStatus;
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
};

// Only fixed hints emitted by our SQL, paired with their expected SQLSTATE,
// choose public messages. Never forward arbitrary database messages or hints.
const databaseReasons: Record<string, DatabaseFailure> = {
  aggregate_out_of_range: {
    databaseCode: "PT409",
    status: 409,
    code: "conflict",
    message: "The combined planting total exceeds the supported integer range.",
  },
  audit_actor_unavailable: {
    databaseCode: "PT500",
    status: 500,
    code: "internal_error",
    message: "The account used by the server to save changes is unavailable.",
  },
  species_not_found: {
    databaseCode: "PT404",
    status: 404,
    code: "not_found",
    message: "Species not found.",
  },
  site_not_found: {
    databaseCode: "PT404",
    status: 404,
    code: "not_found",
    message: "Site not found.",
  },
  planting_area_not_found: {
    databaseCode: "PT404",
    status: 404,
    code: "not_found",
    message: "Planting area not found.",
  },
  planting_event_not_found: {
    databaseCode: "PT404",
    status: 404,
    code: "not_found",
    message: "Planting event not found.",
  },
  concurrent_site_move: {
    databaseCode: "PT409",
    status: 409,
    code: "conflict",
    message:
      "The planting event moved to another site. Reload it before trying again.",
  },
  site_unavailable: {
    databaseCode: "PT409",
    status: 409,
    code: "conflict",
    message: "The selected site is missing or inactive.",
    fields: { site_id: "Select an active site." },
  },
  area_site_mismatch: {
    databaseCode: "PT409",
    status: 409,
    code: "conflict",
    message:
      "The planting area is missing or does not belong to the selected site.",
    fields: { planting_area_id: "Select an area belonging to this site." },
  },
  inactive_area: {
    databaseCode: "PT409",
    status: 409,
    code: "conflict",
    message:
      "An inactive planting area can only be kept on its existing event and site.",
    fields: {
      planting_area_id: "Select an active area or remove the area assignment.",
    },
  },
  invalid_count_set: {
    databaseCode: "PT409",
    status: 409,
    code: "conflict",
    message:
      "Every count must have a distinct count ID and a distinct species ID.",
    fields: { species: "Supply each count ID and species ID exactly once." },
  },
  count_belongs_to_another_event: {
    databaseCode: "PT409",
    status: 409,
    code: "conflict",
    message: "A count ID belongs to another planting event.",
    fields: {
      species: "Keep IDs from this event; omit IDs for new count rows.",
    },
  },
  species_unavailable: {
    databaseCode: "PT409",
    status: 409,
    code: "conflict",
    message: "A selected species no longer exists.",
    fields: { species: "Select an existing species for each count." },
  },
  inactive_species: {
    databaseCode: "PT409",
    status: 409,
    code: "conflict",
    message:
      "An inactive species can only be kept on its unchanged existing active count row.",
    fields: {
      species:
        "Select active species for new, changed or reactivated species links.",
    },
  },
  parent_site_immutable: {
    databaseCode: "PT409",
    status: 409,
    code: "conflict",
    message: "A planting area's parent site cannot change.",
    fields: { site_id: "Keep the area's original site." },
  },
};

function databaseHttpError(error: DatabaseError): HttpError {
  const hint = error.hint;
  if (hint?.startsWith("wrt:")) {
    const reason = hint.slice(4);
    const failure = Object.hasOwn(databaseReasons, reason)
      ? databaseReasons[reason]
      : undefined;
    if (failure && failure.databaseCode === error.code) {
      return new HttpError(failure.status, failure.code, failure.message, {
        reason,
        fields: failure.fields,
        cause: error,
      });
    }
  }
  if (error.code === "PT404") {
    return new HttpError(404, "not_found", "Record not found.", {
      reason: "record_not_found",
      cause: error,
    });
  }
  if (["PT409", "23505", "23503"].includes(error.code)) {
    const reason = error.code === "23505"
      ? "duplicate_record"
      : error.code === "23503"
      ? "referenced_record_unavailable"
      : "stored_data_conflict";
    return new HttpError(
      409,
      "conflict",
      "The operation conflicts with the stored data.",
      {
        reason,
        cause: error,
      },
    );
  }
  if (
    [
      "23514",
      "23502",
      "22P02",
      "22P05",
      "PGRST102",
      "22023",
      "22007",
      "22008",
      "22003",
    ].includes(error.code)
  ) {
    return new HttpError(
      400,
      "validation_error",
      "The database could not accept the supplied values.",
      {
        reason: "invalid_values",
        cause: error,
      },
    );
  }
  return new HttpError(
    500,
    "internal_error",
    "The request could not be completed.",
    {
      cause: error,
    },
  );
}

export function throwDatabaseError(
  error: DatabaseError,
  log: RequestLog,
  started: number,
  operation: string,
): never {
  const failure = databaseHttpError(error);
  log("database.failed", {
    database_operation: operation,
    database_code: error.code,
    reason: failure.reason,
    ...exceptionLogFields(failure),
    duration_ms: Math.round(performance.now() - started),
  }, "error");
  throw failure;
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
        {
          reason: "invalid_json",
          cause: error,
        },
      );
    }
    throw error;
  }
}
