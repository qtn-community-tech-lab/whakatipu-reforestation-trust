import { match, ok, strictEqual } from "node:assert/strict";
import { exceptionLogFields } from "../supabase/functions/api/logging.ts";

Deno.test("exception logs retain stack frames and stop cyclic cause chains", () => {
  const cause = new Error("private cause message");
  const error = new Error("private outer message", { cause });
  cause.cause = error;
  const fields = exceptionLogFields(error);
  strictEqual(fields.error_type, "Error");
  strictEqual(fields.cause_1_type, "Error");
  match(String(fields.error_stack), /logging_test\.ts/);
  match(String(fields.cause_1_stack), /logging_test\.ts/);
  strictEqual(fields.cause_2_type, undefined);
  ok(!JSON.stringify(fields).includes("private cause message"));
  ok(!JSON.stringify(fields).includes("private outer message"));
});

Deno.test("exception logs omit messages and credentials from frame URLs", () => {
  const error = new Error("private message\n    at private supplied text");
  error.stack = `${error.name}: ${error.message}
    at remote (https://user:secret@example.test/source.ts:12:4?token=hidden#private)
    at local (file:///app/api.ts:8:2)`;
  const fields = exceptionLogFields(error);
  strictEqual(
    fields.error_stack,
    "    at remote (https://example.test/source.ts:12:4)\n    at local (file:///app/api.ts:8:2)",
  );
  const unstructured = exceptionLogFields({ secret: "unstructured failure" });
  strictEqual(unstructured.error_type, "UnknownError");
  strictEqual(unstructured.error_stack_source, "logging_boundary");
  match(String(unstructured.error_stack), /logging_test\.ts/);
  ok(!JSON.stringify(unstructured).includes("unstructured failure"));
});
