import { match, ok, strictEqual, throws } from "node:assert/strict";
import {
  HttpError,
  throwDatabaseError,
} from "../supabase/functions/api/http.ts";

Deno.test("fixed database hints expose useful reasons without raw details", () => {
  const error = {
    code: "PT409",
    hint: "wrt:inactive_species",
    message: "private database message",
    details: "private rejected row",
  };
  const logLines: string[] = [];
  throws(() => {
    throwDatabaseError(
      error,
      (event, fields) => {
        logLines.push(JSON.stringify({ event, ...fields }));
      },
      performance.now(),
      "planting_event_save",
    );
  }, (failure: unknown) => {
    ok(failure instanceof HttpError);
    strictEqual(failure.status, 409);
    strictEqual(failure.reason, "inactive_species");
    ok(failure.fields?.species);
    ok(!failure.message.includes("private"));
    return true;
  });
  strictEqual(logLines.length, 1);
  match(logLines[0], /inactive_species/);
  match(logLines[0], /error_stack/);
  ok(!logLines[0].includes("private"));
});

Deno.test("unknown hints and mismatched SQLSTATEs cannot choose public failures", () => {
  for (
    const hint of [
      "wrt:inactive_species",
      "wrt:__proto__",
      "wrt:unknown_reason",
      "private hint",
    ]
  ) {
    const error = { code: "XX000", hint };
    throws(() => {
      throwDatabaseError(error, () => {}, performance.now(), "species_get");
    }, (failure: unknown) => {
      ok(failure instanceof HttpError);
      strictEqual(failure.status, 500);
      strictEqual(failure.reason, "internal_error");
      strictEqual(failure.message, "The request could not be completed.");
      return true;
    });
  }
});
