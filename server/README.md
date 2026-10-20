# WRT server API

The `api` Supabase Edge Function implements species, site, planting-area and planting-event CRUD using Deno, Hono and the official Supabase server SDK. Development requests need no sign-in or API key at the handler. All active species, sites, planting areas and planting events, including unpublished records, are readable and editable. Google authentication and hosted deployment are later work.

Use clear, direct TypeScript and Postgres code at an advanced graduate level. The [server agent guide](AGENTS.md) defines the coding rules; [the canonical HTTP contracts](../shared/api-types.ts) and the [spec's current development increment](../planning/spec.md#current-development-increment-all-four-domain-crud-apis) define the current behavior.

Requests are assumed to match the TypeScript contracts. There is no Zod or replacement application request/response validation. Malformed JSON returns 400; Postgres constraints continue to enforce stored integrity. Extra body properties are ignored, trusted code supplies audit identities, and query strings do not filter results.

## Run locally

Install Docker, the Supabase CLI and Deno. This implementation was checked with Supabase CLI 2.121.0 and Deno 2.9.7, using the local Supabase Edge Runtime too.

From `server/`:

```sh
supabase start
supabase migration up --local
```

Initial startup applies migrations automatically; `migration up --local` applies pending migrations to an existing stack without a reset. Writes use the development actor `usr_000000000001` inserted by the domain migration. The API does not create or change this actor at startup; a missing/inactive actor makes writes fail with a sanitized 500.

There is no separate application build step: Deno resolves the pinned dependencies from `supabase/functions/api/deno.json` and its committed lockfile. The `check` task type-checks the application, tests and runner; it does not start the API.

Run `supabase functions serve api` from `server/`. The local function is available at `http://127.0.0.1:54321/functions/v1/api`. To supply custom origins:

```sh
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve api --env-file supabase/functions/.env
```

`ALLOWED_ORIGINS` is a comma-separated list; its defaults are `http://localhost:3000` and `http://127.0.0.1:3000`. An empty value allows no browser origins. Supabase injects the project URL and server credentials; the SDK context resolves them. Never commit real environment files or put privileged credentials in frontend variables.

## Endpoints

All 20 domain CRUD routes are implemented. Paths below are relative to the function URL. Each resource supports GET/POST on its collection and GET/PUT/DELETE on `/:id`.

| Collection | List order | POST identity | Nested writes |
| --- | --- | --- | --- |
| `/species` | Scientific name, then ID ascending | Server-generated species ID | None |
| `/sites` | Name, then ID ascending | Server-generated site ID | Location geometry; server creates or retains the location ID |
| `/planting-areas`  | Name, then ID ascending            | Server-generated area ID    | Supplied new location ID and geometry; parent site stays fixed      |
| `/planting-events` | Planting date, then ID descending  | Server-generated event ID   | Complete species-count set; omit new line IDs for server generation |

Lists return complete plain arrays and details return full objects. Query parameters have no effect. PUT replaces the complete editable form and takes identity from the path. POST returns 201 and a relative `Location` header with the ID percent-encoded as a URL path segment. JSON IDs retain their original values; clients should encode IDs when constructing URLs.

The following species routes illustrate the common status/body behavior:

| Method | Path           | Result                                                   |
| ------ | -------------- | -------------------------------------------------------- |
| GET    | `/species`     | 200, complete array sorted by scientific name then ID    |
| GET    | `/species/:id` | 200, full detail, totals and complete event summaries    |
| POST   | `/species`     | 201, full detail and a relative `Location` header        |
| PUT    | `/species/:id` | 200, full detail after saving the complete editable form |
| DELETE | `/species/:id` | 204 with no body; soft deactivation                      |

Sites use the same five CRUD methods at `/sites` and `/sites/:id`. Lists sort by name then ID and include `position`; details include location, totals, species totals, planting areas and events. No authentication is required, including for unpublished sites.

Site POST and PUT accept all four editable fields. The server generates the site ID and any new location ID. A geometry edit retains the location ID; null detaches and deactivates it. Adding geometry later generates a fresh location ID. Site deletion also deactivates its location, retaining the historical link and leaving child rows intact. Unknown or inactive sites return 404 for GET/PUT; repeated DELETE returns empty 204.

```sh
curl -i http://127.0.0.1:54321/functions/v1/api/sites \
  -H 'Content-Type: application/json' \
  -d '{"name":"Lake Hayes","description":"Lakeside planting","location":{"geometry":{"type":"Point","coordinates":[168.81,-44.98]}},"is_public":false}'

curl http://127.0.0.1:54321/functions/v1/api/sites
curl "http://127.0.0.1:54321/functions/v1/api/sites/<site-id>"

curl -i -X PUT "http://127.0.0.1:54321/functions/v1/api/sites/<site-id>" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Lake Hayes","description":"Updated description","location":null,"is_public":true}'

curl -i -X DELETE "http://127.0.0.1:54321/functions/v1/api/sites/<site-id>"
```

Only Point geometry is supported in this release, with longitude first. Use `"location": null` when the site has no known position. Do not include a site or location ID in either body.

Planting areas use the same CRUD methods at `/planting-areas` and `/planting-areas/:id`. Lists sort by name then ID and include the current parent-site summary and the area's own position. Details include location, totals, species totals and event history. All active areas under active sites are accessible, including unpublished areas/sites. An unlocated area has null position; it does not inherit the site pin.

The server generates the area ID on POST. Area location input still accepts a caller-supplied location ID with geometry. PUT uses its path ID and accepts the complete five editable fields: `site_id`, `name`, `description`, `location`, `is_public`. The parent site cannot change. Top-level IDs/audit fields added to POST or PUT have no effect.

```sh
curl -i http://127.0.0.1:54321/functions/v1/api/planting-areas \
  -H 'Content-Type: application/json' \
  -d '{"site_id":"<site-id>","name":"Northern bank","description":"","location":{"id":"loc_000000000001","geometry":{"type":"Point","coordinates":[168.81,-44.98]}},"is_public":false}'

curl http://127.0.0.1:54321/functions/v1/api/planting-areas
curl "http://127.0.0.1:54321/functions/v1/api/planting-areas/<area-id>"

curl -i -X PUT "http://127.0.0.1:54321/functions/v1/api/planting-areas/<area-id>" \
  -H 'Content-Type: application/json' \
  -d '{"site_id":"<site-id>","name":"Northern bank","description":"Updated description","location":null,"is_public":true}'

curl -i -X DELETE "http://127.0.0.1:54321/functions/v1/api/planting-areas/<area-id>"
```

Replace the placeholders and choose a fresh location ID for each new location; the example ID is illustrative. Existing owned location IDs allow in-place edits. A different unused location ID replaces/deactivates the old location; null detaches/deactivates it. Historical IDs and locations belonging to another site/area return 409, as do parent changes and unavailable create parents. Failed writes roll back both area and location changes.

Area DELETE deactivates its owned location and preserves event links. Repeated DELETE under an active parent returns 204. Unknown/inactive area reads and updates return 404; an inactive parent also makes area GET/PUT/DELETE return 404. No child rows are cascaded when deleting a site.

Planting events use the same five CRUD methods at `/planting-events` and `/planting-events/:id`. Lists sort by planting date descending, then ID descending. POST generates a 16-character event ID on the server. Both POST and PUT include every editable field and the complete desired `species` line set. Omit `id` for each new count line; the server generates it and returns it in the response. Retain returned line IDs when editing existing counts. PUT identity comes from the path, and audit fields are ignored.

```sh
curl -i http://127.0.0.1:54321/functions/v1/api/planting-events \
  -H 'Content-Type: application/json' \
  -d '{"site_id":"<site-id>","planting_area_id":null,"planting_date":"2026-10-19","event_type":"establishment","season":"Spring","notes":"First planting","image_url":"","is_public":false,"species":[{"species_id":"<species-id>","quantity":25}]}'

curl http://127.0.0.1:54321/functions/v1/api/planting-events
curl "http://127.0.0.1:54321/functions/v1/api/planting-events/<event-id>"

curl -i -X PUT "http://127.0.0.1:54321/functions/v1/api/planting-events/<event-id>" \
  -H 'Content-Type: application/json' \
  -d '{"site_id":"<site-id>","planting_area_id":null,"planting_date":"2026-10-19","event_type":"infill","season":"Spring","notes":"Corrected quantity","image_url":"","is_public":true,"species":[{"id":"<returned-line-id>","species_id":"<species-id>","quantity":30},{"species_id":"<another-species-id>","quantity":5}]}'

curl -i -X DELETE "http://127.0.0.1:54321/functions/v1/api/planting-events/<event-id>"
```

Replace placeholders with returned IDs. In the PUT example, the first count is edited and the second is added without a line ID. If the catalogue species itself is new, create it through `POST /species` first and use its returned ID as `species_id`. `season` is free text (e.g. Summer or autumn); send `""` when unspecified. Event lists, embedded histories and details include `season` and `image_url`. Every count and species total contains a non-null species reference. `event_type` is `establishment`, `infill` or `replacement`; dates are calendar dates, and quantities are non-negative safe integers. Omitted lines are soft-deactivated; `species: []` removes all active lines. Previously omitted line IDs may be reactivated for the same event when their species is active. Duplicate line/species IDs, another event's line IDs, invalid parent assignments and new inactive references return 409. Any failure rolls back the event and every count change.

An unchanged active line can keep an inactive species, including quantity edits. An unchanged inactive-area link may also be retained; details show `is_active: false`, while list summaries show a null area. Effective geometry uses the active area's location, falling back to the site's location. Event sites may change with a consistent active area or null. Deleting an event preserves its count history and removes it from all ordinary totals/history; repeated DELETE returns 204. An inactive site makes child event GET/PUT/DELETE return 404.

For species, POST and PUT share the same body. All six fields belong in the editable form; POST generates a 16-character `spc_` ID on the server. PUT takes its ID from the path. Caller IDs, audit fields and other extra properties are never forwarded to the database.

```sh
curl -i http://127.0.0.1:54321/functions/v1/api/species \
  -H 'Content-Type: application/json' \
  -d '{"scientific_name":"Sophora microphylla","common_name":"Kōwhai","aliases":["South Island kōwhai"],"description":"","image_url":"","is_public":false}'

curl http://127.0.0.1:54321/functions/v1/api/species

curl "http://127.0.0.1:54321/functions/v1/api/species/<species-id>"

curl -i -X PUT "http://127.0.0.1:54321/functions/v1/api/species/<species-id>" \
  -H 'Content-Type: application/json' \
  -d '{"scientific_name":"Sophora microphylla","common_name":"Kōwhai","aliases":[],"description":"Updated description","image_url":"","is_public":true}'

curl -i -X DELETE "http://127.0.0.1:54321/functions/v1/api/species/<species-id>"
```

Replace `<species-id>` with the returned ID. Inactive species return 404 for GET/PUT. Repeated DELETE returns 204 without rewriting audit fields; unknown IDs return 404. HEAD follows GET and OPTIONS handles preflight. Unsupported methods return 405 with `Allow`. Errors use `{ "error": { "code": "...", "message": "..." } }`. Database errors and credentials are never exposed.

Responses use `Cache-Control: private, no-store` and a generated `X-Request-ID`. Verbose structured JSON logs are enabled for all implemented resources. Each line includes a timestamp, level, event name, request ID, method and path. The response's `X-Request-ID` connects the browser request to its logs.

Logs trace request start/completion, database context initialization, POST/PUT JSON parsing, each resource operation, and every catalogue batch with its offset, row count and duration. Write logs include the resource ID and trusted audit actor. Detail completions include the related event/count-line count. Database failures include their code and elapsed time; HTTP failures include the sanitized error code, status and error type. A repeated DELETE completion means the idempotent RPC succeeded, not that a new deactivation timestamp was written.

Run `supabase functions serve api` from `server/` to see logs in the terminal. Filter by `request_id` to follow a request; the last started stage before `database.failed` or `request.failed` identifies where it stopped. Logs omit request bodies, response bodies, credentials, headers, query strings and raw database messages/details, which can contain supplied values. The test runner suppresses function logs to keep its bulk test output readable.

## Database and contracts

Species, site and planting-area lists use ordinary typed Supabase queries with internal batches, continuing until no rows remain even when the configured row cap is smaller than a batch. These resources use four invoker RPCs for detail/create/update/deactivate. Events use detail/list/save/deactivate RPCs: one shared save transaction handles create and full replacement, and the list returns a complete typed summary array in one snapshot. Only `service_role` can execute them; browser roles have no table or RPC access, and RLS stays enabled with no browser-facing policies. Runtime table grants allow SELECT/INSERT/UPDATE, including row locking, but not physical deletion or truncation. Operators retain separate database privileges.

Mutations check and lock the active audit user, lock existing resource rows, preserve creation fields, and update mutation audit fields using database time. The saved row, history and totals are gathered in the same transaction; a database failure rolls back the write. Deactivating a species leaves every planting/count row intact.

TypeScript constructs the public response objects and nested event summaries. SQL returns typed rows and aggregates rather than building API JSON. Detail results contain the resource row and typed arrays of related rows, keeping history complete despite the Data API row cap and preserving a consistent read snapshot.

Site/area totals sum all active count lines under active events and sites, including unpublished records in this development scope. Their event counts include empty events. Species histories and event counts include only positive matching quantities; zero lines remain in event details for editing. Species totals count only the selected species; embedded event totals count all active lines, including inactive species. Inactive areas become null in event summaries; editor event details retain their historical identity. Event `species_ids` contains positive active catalogue references only. Histories sort by date descending then ID descending. Unsafe aggregate quantities return 409 before JavaScript parses JSON; failed reads never become fake zero totals.

Site detail includes every active event, including events without counts. Its total sums all active event lines, including inactive catalogue references; editor species summaries retain those identities and omit zero-only groups. Active areas sort by name/ID; events sort by date/ID descending. Independent aggregates prevent areas and species joins from multiplying quantities. Apply changes through new additive migrations once a migration has been applied; preserve existing data and migration history.

Planting-area detail aggregates only events assigned to that area under its active parent site; it does not allocate site-only events. The read uses one snapshot and typed complete arrays, with safe integer checks before JSON conversion. Area writes lock the active actor, then parent site, area and owned location. A parent lock prevents concurrent site deletion from leaving a partially successful area save. Location inserts use primary-key conflicts to reject existing and concurrently claimed IDs across both owner tables.

Event saves lock the actor, parent sites in ID order, the event, optional area, species in ID order and existing count rows. Parent locks prevent deletion races. A rare concurrent site move detected after acquiring the event lock returns 409 so the caller can retry with the current state. Desired sets are checked before changing lines; temporary deactivation inside the transaction allows species swaps without violating the active-pair unique index. Upserts preserve line creation fields and never move a line between events. SQL accepts the desired lines as JSONB input, returns typed rows, and checks event sums before JSON conversion. JSONB input for the desired set and stored geometry does not move HTTP response assembly into SQL.

Expected database conflicts return 409; known constraint, numeric/date, null-byte and malformed-Unicode input errors return sanitized 400 responses. Unexpected failures remain sanitized 500s. The alias constraint guards its dimensionality before calling array operations, so nested arrays fail as constraint violations. These checks preserve database integrity without adding application request validators.

The six migrations currently define the seven domain tables, species/site/area/event read and write RPCs, server-only grants, supporting indexes, the guarded species-alias constraint and event season/summary fields. Development actors live in the domain migration; there is no separate fixture seed or startup provisioning step. Historical import is specified but its operator script has not been implemented.

The canonical HTTP contracts and primitives live in the monorepo's `shared/api-types.ts`. The function's `deno.json` maps `@wrt/api-types` to that file, and server modules use `import type` so these imports are erased from runtime code. Keep this shared module limited to types; runtime utilities need separate consideration for Supabase bundling and local container paths. Database types are generated separately; `api/database.types.ts` describes the non-null composite result fields guaranteed by SQL, which introspection cannot infer. RPC calls use explicit result-type overrides without runtime validation.

After changing migrations, apply them locally without a reset and regenerate persistence types. Constraint-only changes may produce identical types; keep the generated file unchanged when the formatted result matches:

```sh
supabase migration up --local
supabase gen types typescript --local --schema public > /tmp/wrt-database.types.ts && cp /tmp/wrt-database.types.ts supabase/functions/_shared/database.types.ts
deno fmt supabase/functions/_shared/database.types.ts
```

## Checks

Run from `server/`:

```sh
deno fmt --check supabase/functions tests scripts ../shared ../planning/db-schema.ts
deno lint --config supabase/functions/api/deno.json supabase/functions tests scripts ../shared ../planning/db-schema.ts
deno task --config supabase/functions/api/deno.json check
supabase db lint --local --level warning
```

The current test inventory is:

| Suite | Steps | Main coverage |
| --- | ---: | --- |
| `tests/species_test.ts` | 6 | Catalogue CRUD, fields, constraints, HTTP behavior and complete lists |
| `tests/sites_test.ts` | 9 | Site CRUD, owned-location lifecycle, rollback, concurrent saves and complete lists |
| `tests/planting-areas_test.ts` | 11 | Area CRUD, immutable parents, location ownership/history and complete nested collections |
| `tests/planting-events_test.ts` | 14 | Event CRUD, desired count sets, inactive references, totals, concurrency and complete events/lines |
| `tests/workflows_test.ts` | 13 | Cross-resource reconciliation, unusual inputs, rollback, live references and deletion races |

The contract-update verification on 20 October 2026 passed formatting, lint, type checks and database lint. All 14 planting-event steps passed. The full HTTP run finished with 36 passing and 17 failing steps after local Edge worker startup failures, gateway errors/timeouts and eventual connection refusal. Some test-fixture cleanup and local migration-history reconciliation remain incomplete because Docker became unresponsive; this is not a clean full-suite pass.

Run all HTTP suites with Docker running, from `server/`. Stop any manually served function process first; the runner owns its serving process:

```sh
deno task --config supabase/functions/api/deno.json test
# Or select one resource:
deno task --config supabase/functions/api/deno.json test:sites
deno task --config supabase/functions/api/deno.json test:species
deno task --config supabase/functions/api/deno.json test:planting-areas
deno task --config supabase/functions/api/deno.json test:planting-events
# Smaller cross-resource regression suite:
deno task --config supabase/functions/api/deno.json test:workflows
```

The shared `scripts/test-api.ts` runner starts the local Supabase stack, applies pending migrations without a reset and serves the `api` Edge Function. Tests call the real local HTTP endpoints without authentication. The runner stops its function-serving process afterwards and leaves Supabase running. Local `edge_runtime.policy` is `"oneshot"`: each request gets a fresh worker, avoiding cumulative CPU retirement races during bulk tests. This also exercises cold starts, so bulk suites take several minutes each; local tests do not establish hosted throughput. See the [Supabase CLI serving reference](https://supabase.com/docs/reference/cli/supabase-functions-serve) for worker policies.

Coverage includes complete create/read/update/delete responses, server IDs, preserved creation timestamps, unpublished records, ignored caller ID/audit fields, repeated deletion, unknown/inactive IDs, malformed JSON, database-constraint rollback, sanitized errors, response headers, HEAD/OPTIONS/405 handling, ordering and complete lists of more than 1,000 records. The list test also verifies that query parameters do not introduce pagination or filtering.

Site tests additionally cover location creation, retaining an ID on geometry changes, detach/reattach with a fresh ID, ignored supplied location IDs, independent location ownership, rejected geometry, rollback after nested writes and concurrent complete saves. Lists exceed 1,000 sites and include both located and unlocated, public and unpublished records.

Area tests cover server-generated IDs, immutable parents, current site references, location ownership across sites/areas, historical-ID conflicts, concurrent claims/saves, rollback, inactive parents and all HTTP methods. They also verify complete nested site collections with more than 1,000 areas. Parent sites are created through POST /sites; cleanup deletes areas first. The parent-deletion case retains its inaccessible child rows as history, matching the lifecycle rule.

Every fixture is created and cleaned up through the implemented HTTP endpoints. Each resource suite creates over 1,000 records; cleanup soft-deactivates them, so historical test rows remain locally. Tests use a fixed loopback URL, bounded concurrency and `finally` cleanup, leaving unrelated data untouched. Avoid concurrent manual edits while testing list completeness. All suites share HTTP assertion helpers in `tests/http.ts`.

Event tests cover non-zero site/area/species totals and histories, whole-event summaries, zero lines, desired-set swaps/omission/reactivation, retained inactive references, ownership conflicts, parent changes/deletion, constraint and unsafe-sum rollback, concurrent saves/claims and complete collections with more than 1,000 events and count lines. Every related fixture is created through HTTP. New species/sites/areas are also checked for empty related arrays and zero totals. Internal audit fields and deactivation timestamps are not exposed by responses, so the HTTP suites cannot directly verify them. Authentication remains deferred.

`tests/workflows_test.ts` adds smaller cross-resource regressions: reconcile totals/history after event moves and complete line edits, refresh current names/catalogue metadata/location fallback, reject cumulative overflow across individually safe events, prove failed parent edits roll back and recover after deletion, preserve inactive-reference history, race event saves against area/species deletion, and check calendar/scalar constraints and unknown routes. It uses the same local stack and HTTP-only fixtures; `test:workflows` avoids repeating the bulk suites.

Additional workflow regressions cover literal Unicode/SQL-like text, duplicate/empty aliases, coordinate extrema and malformed geometry, catalogue constraint rollback (including null bytes and malformed Unicode), three-way count swaps, ownership of lines under deleted events, and ignored supplied Unicode/reserved-character resource IDs. Returned `Location` URLs percent-encode IDs; response-body IDs remain unchanged. A guarded alias constraint rejects multidimensional arrays with a normal 400 instead of an unsupported-operation 500.

All 20 domain CRUD routes in the spec are implemented. Locations and event-species lines are nested resources, not additional endpoints; historical import remains an operator script. Current coverage is behavioral HTTP integration coverage, not a measured 100% line/branch result. Direct verification of private audit/deactivation fields and active-actor failure paths, automated browser-role/default-grant checks, hosted CORS/runtime behavior, migration replay/recovery and the future authentication/public-view rules need separate checks. Historical import and its tests are also outstanding. Do not label these gaps covered by successful CRUD tests.

Supabase CLI 2.121.0's local Kong CORS plugin handles preflights with 200 (the function itself uses 204) and rewrites `Access-Control-Allow-Origin` to `*`, even when the function returns a configured origin. Generated Kong configuration is left under CLI control. Verify effective gateway CORS when deploying to a hosted development project; local behavior does not establish hosted behavior.

## Later hosted deployment

Keep schema changes in new migrations and apply them before deploying the function. The fixed development actor, open editor access and absence of application request validation are explicit current choices, not claims of completed production access control. Implement the agreed Google authentication and real actor resolution before a production release. No hosted deployment is performed by the commands above.

Supabase references: [Edge Function organization](https://supabase.com/docs/guides/functions/development-tips), [server framework integration](https://supabase.com/docs/reference/server/frameworks), [database functions](https://supabase.com/docs/guides/database/functions), [PostgREST error codes](https://docs.postgrest.org/en/stable/references/errors.html).
