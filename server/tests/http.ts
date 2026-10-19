import { deepStrictEqual, match, ok, strictEqual } from "node:assert/strict";
import type { ErrorResponse } from "@wrt/api-types";
const baseUrl = "http://127.0.0.1:54321/functions/v1/api";

export async function request(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<Response> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  strictEqual(
    response.headers.get("Cache-Control"),
    "private, no-store",
    `${method} ${path} returned HTTP ${response.status} without the expected cache header`,
  );
  match(response.headers.get("X-Request-ID") ?? "", /^[0-9a-f-]{36}$/);
  return response;
}

export async function readJson<T>(
  response: Response,
  status = 200,
): Promise<T> {
  const text = await response.text();
  strictEqual(response.status, status, `${response.url}: ${text}`);
  match(response.headers.get("Content-Type") ?? "", /application\/json/);
  return JSON.parse(text);
}

export async function expectError(
  response: Response,
  status: number,
  code: string,
): Promise<void> {
  const body = await readJson<ErrorResponse>(response, status);
  deepStrictEqual(Object.keys(body), ["error"]);
  deepStrictEqual(Object.keys(body.error).sort(), ["code", "message"]);
  strictEqual(body.error.code, code);
  ok(body.error.message.length > 0);
  ok(!/SQL|constraint|stack|postgres|PL\/pgSQL/i.test(body.error.message));
}

// A small worker pool bounds requests while still waiting for every in-flight
// write before cleanup, including when one request fails.
export async function inBatches<T>(
  items: T[],
  action: (item: T) => Promise<void>,
): Promise<void> {
  for (let offset = 0; offset < items.length; offset += 8) {
    const results = await Promise.allSettled(
      items.slice(offset, offset + 8).map(action),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
