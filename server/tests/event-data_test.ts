import { deepStrictEqual, ok, strictEqual, throws } from "node:assert/strict";
import { summarizeEventLines } from "../supabase/functions/api/event-data.ts";
import { HttpError } from "../supabase/functions/api/http.ts";

Deno.test("event summaries accept safe individual totals even when their combined total is unsafe", () => {
  const summaries = summarizeEventLines([
    {
      event_id: "maximum",
      species_id: "first",
      quantity: String(Number.MAX_SAFE_INTEGER),
      species_deactivated_at: null,
    },
    {
      event_id: "extra",
      species_id: "first",
      quantity: "1",
      species_deactivated_at: null,
    },
  ]);
  strictEqual(summaries.get("maximum")?.total_plants, Number.MAX_SAFE_INTEGER);
  strictEqual(summaries.get("extra")?.total_plants, 1);
});

Deno.test("event summaries count inactive species quantities but expose only positive active species IDs", () => {
  const summaries = summarizeEventLines([
    {
      event_id: "event",
      species_id: "active",
      quantity: "3",
      species_deactivated_at: null,
    },
    {
      event_id: "event",
      species_id: "inactive",
      quantity: "4",
      species_deactivated_at: new Date(),
    },
    {
      event_id: "event",
      species_id: "zero",
      quantity: "0",
      species_deactivated_at: null,
    },
  ]);
  deepStrictEqual(summaries.get("event"), {
    total_plants: 7,
    species_ids: ["active"],
  });
});

Deno.test("event summaries still reject an unsafe total within one event", () => {
  throws(() =>
    summarizeEventLines([
      {
        event_id: "event",
        species_id: "first",
        quantity: String(Number.MAX_SAFE_INTEGER),
        species_deactivated_at: null,
      },
      {
        event_id: "event",
        species_id: "second",
        quantity: "1",
        species_deactivated_at: null,
      },
    ]), (error: unknown) => {
    ok(error instanceof HttpError);
    strictEqual(error.status, 409);
    strictEqual(error.reason, "aggregate_out_of_range");
    return true;
  });
});
