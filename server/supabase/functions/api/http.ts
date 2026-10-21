import type { ErrorResponse } from "@wrt/api-types";

type ErrorCode = ErrorResponse["error"]["code"];
type ErrorStatus = 400 | 404 | 405 | 409 | 500;

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
