# WRT species API

The `api` Supabase Edge Function implements species CRUD using Deno, Hono and the official Supabase server SDK. Development requests need no sign-in or API key at the handler. All active species, including unpublished records, are readable and editable. Google authentication and hosted deployment are later work.

Requests are assumed to match the TypeScript contracts. There is no Zod or replacement application request/response validation. Malformed JSON returns 400; Postgres constraints continue to enforce stored integrity. Extra body properties are ignored, and query strings do not filter results.

## Run locally

Install Docker, the Supabase CLI and Deno. This implementation was checked with Supabase CLI 2.121.0 and Deno 2.9.7, using the local Supabase Edge Runtime too.

From `server/`:

```sh
supabase start
supabase migration up --local
```

Initial startup applies migrations automatically. The latter two commands also support an existing local stack without a reset. The API does not create or change this actor at startup; a missing/inactive actor makes writes fail with a sanitized 500.

The local function is available at `http://127.0.0.1:54321/functions/v1/api`. If serving it separately, or supplying custom origins:

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

POST and PUT share the same body. All six fields belong in the editable form; POST generates a 16-character `spc_` ID on the server. PUT takes its ID from the path. Caller IDs, audit fields and other extra properties are never forwarded to the database.

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

Responses use `Cache-Control: private, no-store` and a generated `X-Request-ID`. Verbose structured JSON logs are enabled for species requests. Each line includes a timestamp, level, event name, request ID, method and path. The response's `X-Request-ID` connects the browser request to its logs.

Logs trace request start/completion, database context initialization, POST/PUT JSON parsing, each species operation, and every catalogue batch with its offset, row count and duration. Write logs include the server-generated species ID and trusted audit actor. Detail completions include the event count. Database failures include their code and elapsed time; HTTP failures include the sanitized error code, status and error type. A repeated DELETE completion means the idempotent RPC succeeded, not that a new deactivation timestamp was written.

Run `supabase functions serve api` from `server/` to see logs in the terminal. Filter by `request_id` to follow a request; the last started stage before `database.failed` or `request.failed` identifies where it stopped. Logs omit request bodies, response bodies, credentials, headers, query strings and raw database messages/details, which can contain supplied values. The test runner suppresses function logs to keep its bulk test output readable.

## Database and contracts

Catalogue lists use ordinary typed Supabase queries with internal batches, continuing until no rows remain even when the configured row cap is smaller than a batch. Four invoker RPCs implement detail/create/update/deactivate. Only `service_role` can execute them; browser roles have no table or RPC access, and RLS stays enabled with no browser-facing policies. Runtime table grants allow SELECT/INSERT/UPDATE, including row locking, but not physical deletion or truncation. Operators retain separate database privileges.

Mutations check and lock the active audit user, lock existing species, preserve creation fields, and update mutation audit fields using database time. The saved row, history and totals are gathered in the same transaction; a database failure rolls back the write. Deactivating a species leaves every planting/count row intact.

TypeScript constructs the public response objects and nested event summaries. SQL returns typed rows and aggregates rather than building API JSON. Detail results contain one species row and a typed array of flat event rows, keeping history complete despite the Data API row cap and preserving a consistent read snapshot.

Details count positive active lines under active events and sites, including unpublished records in this development scope. Species totals count only the selected species; embedded event totals count all active lines, including inactive species. Inactive areas become null. Event `species_ids` contains positive active catalogue references only. Histories sort by date descending then ID descending. Unsafe aggregate quantities return 409 before JavaScript parses JSON; failed reads never become fake zero totals.

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

Run the species HTTP suite with Docker running, from `server/`:

```sh
deno task --config supabase/functions/api/deno.json test:species
```

The runner starts the local Supabase stack, applies pending migrations without a reset and serves the `api` Edge Function. Tests call the real local HTTP endpoints without authentication. The runner stops its function-serving process afterwards and leaves Supabase running.

Coverage includes complete create/read/update/delete responses, server IDs, preserved creation timestamps, unpublished records, ignored caller ID/audit fields, repeated deletion, unknown/inactive IDs, malformed JSON, database-constraint rollback, sanitized errors, response headers, HEAD/OPTIONS/405 handling, ordering and complete lists of more than 1,000 records. The list test also verifies that query parameters do not introduce pagination or filtering.

Every fixture is created through `POST /species` and cleaned up through `DELETE /species`, including after test assertion failures. Each run creates over 1,000 species; cleanup soft-deactivates them, so historical test rows remain in the local database. The suite uses a fixed loopback URL and bounded concurrency, and never changes unrelated species or resets local data. Avoid concurrent manual catalogue edits while checking list ordering/completeness.

Non-zero event history/totals tests wait until site and planting-event endpoints exist: this suite intentionally does not bypass the HTTP API to insert related fixtures. It asserts empty history and zero totals for new species. Audit actor IDs and the original internal deactivation timestamp are not exposed by species responses, so this HTTP suite cannot directly verify those database fields. Other test suites remain deferred.

Supabase CLI 2.121.0's local Kong CORS plugin handles preflights with 200 (the function itself uses 204) and rewrites `Access-Control-Allow-Origin` to `*`, even when the function returns a configured origin. Generated Kong configuration is left under CLI control. Verify effective gateway CORS when deploying to a hosted development project; local behavior does not establish hosted behavior.

## Later hosted deployment

Keep schema changes in new migrations and apply them before deploying the function. The fixed development actor, open editor access and absence of application request validation are explicit current choices, not claims of completed production access control. Implement the agreed Google authentication and real actor resolution before a production release. No hosted deployment is performed by the commands above.

Supabase references: [Edge Function organization](https://supabase.com/docs/guides/functions/development-tips), [server framework integration](https://supabase.com/docs/reference/server/frameworks), [database functions](https://supabase.com/docs/guides/database/functions).
