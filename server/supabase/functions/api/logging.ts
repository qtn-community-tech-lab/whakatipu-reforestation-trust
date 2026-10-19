type LogFields = Record<string, string | number | boolean | null>;
type LogLevel = "info" | "warn" | "error";

export type RequestLog = (
  event: string,
  fields?: LogFields,
  level?: LogLevel,
) => void;

export function createRequestLog(
  requestId: string,
  method: string,
  path: string,
): RequestLog {
  return (event, fields = {}, level = "info") => {
    console[level](JSON.stringify({
      ...fields,
      timestamp: new Date().toISOString(),
      level,
      event,
      request_id: requestId,
      method,
      path,
    }));
  };
}
