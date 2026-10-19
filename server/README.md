# WRT server API

The `api` Supabase Edge Function implements species and site CRUD using Deno, Hono and the official Supabase server SDK. Development requests need no sign-in or API key at the handler. All active species and sites, including unpublished records, are readable and editable. Google authentication and hosted deployment are later work.

Requests are assumed to match the TypeScript contracts. There is no Zod or replacement application request/response validation. Malformed JSON returns 400; Postgres constraints continue to enforce stored integrity. Extra body properties are ignored, and query strings do not filter results.

## Run locally

Install Docker, the Supabase CLI and Deno. This implementation was checked with Supabase CLI 2.121.0 and Deno 2.9.7, using the local Supabase Edge Runtime too.

From `server/`:

```sh
supabase start
supabase migration up --local
```

Initial startup applies migrations automatically; `migration up --local` applies pending migrations to an existing stack without a reset. Writes use the development actor `usr_000000000001` inserted by the domain migration. The API does not create or change this actor at startup; a missing/inactive actor makes writes fail with a sanitized 500.

Run `supabase functions serve api` from `server/`. The local function is available at `http://127.0.0.1:54321/functions/v1/api`. To supply custom origins:

```sh
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve api --env-file supabase/functions/.env
```

`ALLOWED_ORIGINS` is a comma-separated list; its defaults are `http://localhost:3000` and `http://127.0.0.1:3000`. An empty value allows no browser origins. Supabase injects the project URL and server credentials; the SDK context resolves them. Never commit real environment files or put privileged credentials in frontend variables.

## Endpoints

Paths below are relative to the function URL.

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

Responses use `Cache-Control: private, no-store` and a generated `X-Request-ID`. Verbose structured JSON logs are enabled for species and site requests. Each line includes a timestamp, level, event name, request ID, method and path. The response's `X-Request-ID` connects the browser request to its logs.

Logs trace request start/completion, database context initialization, POST/PUT JSON parsing, each resource operation, and every catalogue batch with its offset, row count and duration. Write logs include the server-generated resource ID and trusted audit actor. Detail completions include the event count. Database failures include their code and elapsed time; HTTP failures include the sanitized error code, status and error type. A repeated DELETE completion means the idempotent RPC succeeded, not that a new deactivation timestamp was written.

Run `supabase functions serve api` from `server/` to see logs in the terminal. Filter by `request_id` to follow a request; the last started stage before `database.failed` or `request.failed` identifies where it stopped. Logs omit request bodies, response bodies, credentials, headers, query strings and raw database messages/details, which can contain supplied values. The test runner suppresses function logs to keep its bulk test output readable.

## Database and contracts

Species and site lists use ordinary typed Supabase queries with internal batches, continuing until no rows remain even when the configured row cap is smaller than a batch. Four invoker RPCs per resource implement detail/create/update/deactivate. Only `service_role` can execute them; browser roles have no table or RPC access, and RLS stays enabled with no browser-facing policies. Runtime table grants allow SELECT/INSERT/UPDATE, including row locking, but not physical deletion or truncation. Operators retain separate database privileges.

Mutations check and lock the active audit user, lock existing resource rows, preserve creation fields, and update mutation audit fields using database time. The saved row, history and totals are gathered in the same transaction; a database failure rolls back the write. Deactivating a species leaves every planting/count row intact.

TypeScript constructs the public response objects and nested event summaries. SQL returns typed rows and aggregates rather than building API JSON. Detail results contain the resource row and typed arrays of related rows, keeping history complete despite the Data API row cap and preserving a consistent read snapshot.

Details count positive active lines under active events and sites, including unpublished records in this development scope. Species totals count only the selected species; embedded event totals count all active lines, including inactive species. Inactive areas become null. Event `species_ids` contains positive active catalogue references only. Histories sort by date descending then ID descending. Unsafe aggregate quantities return 409 before JavaScript parses JSON; failed reads never become fake zero totals.

Site detail includes every active event, including events without counts. Its total sums all active event lines, including inactive catalogue references; editor species summaries retain those identities and omit zero-only groups. Active areas sort by name/ID; events sort by date/ID descending. Independent aggregates prevent areas and species joins from multiplying quantities. New migrations add the site functions and index without changing the existing migrations.

The canonical HTTP contracts and primitives live in the monorepo's `shared/api-types.ts`. The function's `deno.json` maps `@wrt/api-types` to that file, and server modules use `import type` so these imports are erased from runtime code. Keep this shared module limited to types; runtime utilities need separate consideration for Supabase bundling and local container paths. Database types are generated separately; `api/database.types.ts` describes the non-null composite result fields guaranteed by SQL, which introspection cannot infer. RPC calls use explicit result-type overrides without runtime validation.

After changing migrations, regenerate persistence types from the migrated local database:

```sh
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

Run both HTTP suites with Docker running, from `server/`:

```sh
deno task --config supabase/functions/api/deno.json test
# Or select one resource:
deno task --config supabase/functions/api/deno.json test:sites
deno task --config supabase/functions/api/deno.json test:species
```

The shared `scripts/test-api.ts` runner starts the local Supabase stack, applies pending migrations without a reset and serves the `api` Edge Function. Tests call the real local HTTP endpoints without authentication. The runner stops its function-serving process afterwards and leaves Supabase running.

Coverage includes complete create/read/update/delete responses, server IDs, preserved creation timestamps, unpublished records, ignored caller ID/audit fields, repeated deletion, unknown/inactive IDs, malformed JSON, database-constraint rollback, sanitized errors, response headers, HEAD/OPTIONS/405 handling, ordering and complete lists of more than 1,000 records. The list test also verifies that query parameters do not introduce pagination or filtering.

Site tests additionally cover location creation, retaining an ID on geometry changes, detach/reattach with a fresh ID, ignored supplied location IDs, independent location ownership, rejected geometry, rollback after nested writes and concurrent complete saves. Lists exceed 1,000 sites and include both located and unlocated, public and unpublished records.

Every fixture is created and cleaned up through the implemented HTTP endpoints. Each suite creates over 1,000 records; cleanup soft-deactivates them, so historical test rows remain locally. Tests use a fixed loopback URL, bounded concurrency and `finally` cleanup, leaving unrelated data untouched. Avoid concurrent manual edits while testing list completeness. The species and site suites share HTTP assertion helpers in `tests/http.ts`.

Non-zero history/totals and child-visibility tests wait for planting-area/event endpoints: tests do not bypass HTTP to insert related fixtures. New species/sites are checked for empty related arrays and zero totals. Internal audit fields and deactivation timestamps are not exposed by responses, so the HTTP suites cannot directly verify them. Planting areas and events are the next endpoint increments.

Supabase CLI 2.121.0's local Kong CORS plugin handles preflights with 200 (the function itself uses 204) and rewrites `Access-Control-Allow-Origin` to `*`, even when the function returns a configured origin. Generated Kong configuration is left under CLI control. Verify effective gateway CORS when deploying to a hosted development project; local behavior does not establish hosted behavior.

## Later hosted deployment

Keep schema changes in new migrations and apply them before deploying the function. The fixed development actor, open editor access and absence of application request validation are explicit current choices, not claims of completed production access control. Implement the agreed Google authentication and real actor resolution before a production release. No hosted deployment is performed by the commands above.

Supabase references: [Edge Function organization](https://supabase.com/docs/guides/functions/development-tips), [server framework integration](https://supabase.com/docs/reference/server/frameworks), [database functions](https://supabase.com/docs/guides/database/functions).
