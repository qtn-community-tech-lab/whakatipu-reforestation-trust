import { match, ok, strictEqual } from "node:assert/strict";
import {
  databaseErrorLogFields,
  databaseHttpError,
} from "../supabase/functions/api/database.ts";
import { HttpError } from "../supabase/functions/api/http.ts";

Deno.test(
  "database conflicts preserve the original exception without exposing its message",
  () => {
    const original = Object.assign(new Error("private database message"), {
      code: "23505",
      detail: "private rejected row",
      constraint_name: "species_pkey",
    });
    const failure = databaseHttpError(original);
    strictEqual(failure.status, 409);
    strictEqual(failure.reason, "duplicate_record");
    strictEqual(failure.cause, original);
    const fields = databaseErrorLogFields(failure);
    strictEqual(fields.database_code, "23505");
    strictEqual(fields.database_constraint, "species_pkey");
    strictEqual(fields.cause_1_type, "Error");
    match(String(fields.cause_1_stack), /http-errors_test\.ts/);
    ok(!failure.message.includes("private"));
    ok(!JSON.stringify(fields).includes("private"));
  },
);

Deno.test(
  "foreign-key and value errors retain their public status and reasons",
  () => {
    const foreignKey = databaseHttpError({ code: "23503" });
    strictEqual(foreignKey.status, 409);
    strictEqual(foreignKey.reason, "referenced_record_unavailable");
    for (const code of [
      "23514",
      "23502",
      "22P02",
      "22P05",
      "22023",
      "22007",
      "22008",
      "22003",
    ]) {
      const failure = databaseHttpError({ code });
      strictEqual(failure.status, 400);
      strictEqual(failure.reason, "invalid_values");
    }
  },
);

Deno.test(
  "explicit business failures pass through the database boundary unchanged",
  () => {
    const original = new HttpError(
      409,
      "conflict",
      "A selected species no longer exists.",
      {
        reason: "species_unavailable",
        fields: { species: "Select an existing species for each count." },
      },
    );
    strictEqual(databaseHttpError(original), original);
    strictEqual(databaseErrorLogFields(original).database_code, null);
  },
);

Deno.test(
  "unexpected failures cannot choose public messages or reasons using hints",
  () => {
    for (const original of [
      new Error("private connection failure"),
      {
        code: "XX000",
        hint: "wrt:inactive_species",
        message: "private database error",
      },
      { code: "PT409", hint: "wrt:inactive_species" },
    ]) {
      const failure = databaseHttpError(original);
      strictEqual(failure.status, 500);
      strictEqual(failure.reason, "internal_error");
      strictEqual(failure.message, "The request could not be completed.");
      strictEqual(failure.cause, original);
    }
  },
);
