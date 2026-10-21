# WRT server API

The `api` Supabase Edge Function serves species, site, planting-area and planting-event CRUD using Deno, Hono and Kysely. The function connects to Supabase Postgres through `SUPABASE_DB_URL` with a one-connection Postgres.js pool and transaction pooling settings. Supabase injects that URL into Edge Functions; do not copy it into browser configuration or commit it.

The Kysely code migration is complete for all four resources and their 20 routes. This includes the typed table representation, direct reads and writes, transaction and error handling, removal of Supabase JS/RPC code and cleanup of the unreleased migration files. Follow-up simplification is also complete: catalogue lists use one query, detail reads use explicit steps, and writes use transactions without explicit row locks.

Current local requests do not require sign-in. They can read and edit every active record, including unpublished records. Writes use the fixed audit actor `usr_000000000001`. Google authentication, public-view permissions, deployment and historical import tooling are future work. See [the server agent guide](AGENTS.md), [canonical HTTP contracts](../shared/api-types.ts) and [backend specification](../planning/spec.md#current-development-increment-all-four-domain-crud-apis).

Use simple, direct Kysely queries. The manually maintained [database schema](supabase/functions/api/database.schema.ts) maps the seven domain tables; it is separate from HTTP DTOs. `database.ts` opens the Kysely connection and provides pure helpers for error mapping and safe diagnostic fields. `database-helpers.ts` shares actor checks, location reads, date and safe-integer handling. Each resource endpoint uses direct awaited queries and a local `try/catch`; native Kysely transactions are written inline where needed. Resource modules build response objects in TypeScript, check returned values with `satisfies` and infer function return types. There are no custom transaction or query-execution wrappers. The API does not use Supabase JS table queries, RPCs or SQL functions.

Requests are assumed to match the shared TypeScript contracts. There is no runtime request/response validation. Malformed JSON returns 400, extra properties are ignored and database constraints enforce stored integrity.

## Run locally

Install Docker, the Supabase CLI and Deno. The current local setup has been checked with Supabase CLI 2.121.0 and Deno 2.9.7.

From `server/`:

```sh
supabase start
supabase migration up --local
supabase functions serve api
```

The function URL is `http://127.0.0.1:54321/functions/v1/api`. Deno resolves pinned dependencies from `supabase/functions/api/deno.json` and its lockfile; there is no separate application build command. To set allowed browser origins:

```sh
cp supabase/functions/.env.example supabase/functions/.env
supabase functions serve api --env-file supabase/functions/.env
```

`ALLOWED_ORIGINS` is a comma-separated list. Defaults are `http://localhost:3000` and `http://127.0.0.1:3000`; an empty value permits no browser origins. Never commit real environment files or put privileged credentials in frontend variables.

## Endpoints

All 20 domain CRUD routes are implemented. Paths are relative to the function URL. Each resource supports GET/POST on the collection and GET/PUT/DELETE on `/:id`.

| Collection         | List order                         | POST identity               | Nested data                                                    |
| ------------------ | ---------------------------------- | --------------------------- | -------------------------------------------------------------- |
| `/species`         | Scientific name, then ID ascending | Server-generated species ID | None                                                           |
| `/sites`           | Name, then ID ascending            | Server-generated site ID    | Server-owned location geometry                                 |
| `/planting-areas`  | Name, then ID ascending            | Server-generated area ID    | Optional `{ id, geometry }` location; parent site is immutable |
| `/planting-events` | Planting date, then ID descending  | Server-generated event ID   | Complete count set; omitted new line IDs are generated         |

Lists return complete plain arrays; detail routes return full objects. Each catalogue list uses one ordered query. Query parameters do not filter or paginate. PUT replaces the complete editable form and uses the URL ID. POST returns 201 and a relative `Location` header; IDs are percent-encoded in URL path segments and unchanged in response JSON. DELETE soft-deactivates and returns an empty 204.

The API includes active unpublished rows in this development release. Event list summaries include total plants, positive active species IDs and the active area's identity when available. Event details retain inactive area/species references for history. Site/area totals include all active event lines, including inactive species references; unsafe aggregate totals return 409. The event list checks each event total independently and does not calculate an unused grand total.

## Logging and errors

Every request receives a server-generated `X-Request-ID`; each structured log line includes it, the method, path, timestamp, level and event. Follow resource `.started`, `.completed` and `.failed` events, `database.stage` markers and `request.failed` by request ID. `logDatabaseStage` only records the current step; it does not execute or wrap queries. Explicit transactions also set the request ID in Postgres `application_name` for database-side correlation. Single-query lists use the connection's `wrt-api` application name.

Local function logs appear in the terminal running `supabase functions serve api`. Each endpoint catches its query and transaction failures inline, including failures when committing. Failure logs include the resource operation, last stage, duration, known SQLSTATE/constraint/table/column details and sanitized exception stacks with the original cause. They omit request bodies and raw database messages/details. The HTTP boundary preserves the established reason/status mapping and returns sanitized messages; expected constraint/value errors are 400, missing resources are 404, known conflicts are 409 and unexpected failures are 500. Error responses include `reason` and the matching request ID.

## Database and migrations

The single initial migration, `20261019000000_create_domain_tables.sql`, defines all seven tables, constraints, supporting indexes, RLS and role privileges for a fresh database. API queries and transactions live in TypeScript. Browser roles have no table access or RLS policies. The Edge Function uses the server-side database URL, and operators retain separate database access.

Writes run in transactions. They verify the active audit actor, save nested records atomically and return response data from the same transaction. There are no explicit row locks or lock-management queries; concurrent edits use normal Postgres behavior. Detail reads use a repeatable-read transaction so histories and totals share a snapshot. Deactivation retains historical records and repeated accessible deletes preserve the original deactivation timestamp.

Postgres `date` fields are converted to `YYYY-MM-DD` calendar strings. Postgres `bigint` quantities remain strings until TypeScript sums them with `BigInt`; totals are checked before conversion to JSON numbers. Event count swaps deactivate active lines before updating existing rows and inserting new ones, preserving existing line IDs and creation fields while respecting the active-pair unique index.

The six unreleased migrations were consolidated into this initial migration before being applied. Do not reset local data. Do not generate Supabase RPC types for this API; Kysely's schema is maintained in `database.schema.ts`.

## Checks

Run from `server/`:

```sh
deno fmt --check supabase/functions tests scripts ../shared ../planning/db-schema.ts
deno lint --config supabase/functions/api/deno.json supabase/functions tests scripts ../shared ../planning/db-schema.ts
deno task --config supabase/functions/api/deno.json check
```

Formatting, lint, TypeScript and diff checks passed for the completed migration and simplification. Regression tests cover independent event totals and the current error mapper; they were updated but not executed. Database migrations were edited in place and have not been applied as part of this work. Runtime verification against the revised schema remains pending.

The check task type-checks the function, unit tests, HTTP suites and test runner. HTTP test targets use the real local Supabase database and Edge Runtime; they are not run unless requested. Available tasks are `test`, `test:species`, `test:sites`, `test:planting-areas`, `test:planting-events` and `test:workflows`. The runner applies pending migrations without resetting data, creates fixtures through HTTP and soft-deletes its own fixtures.

The five HTTP suites contain 53 steps: species (6), sites (9), planting areas (11), planting events (14) and workflows (13). The previous local full-suite run on 20 October 2026 completed with 36 passing and 17 failing steps after the Docker/Supabase stack became unavailable; the planting-event suite had 14 passing steps. Those results predate the Kysely conversion and do not verify it. Static checks do not establish database/runtime behavior. Direct audit-field checks, database-grant automation, migration replay/recovery, hosted behavior and future authentication rules remain separate work.

## Later hosted deployment

Before deploying, verify hosted Edge Function availability of the database URL, transaction-pool settings, network limits and effective gateway CORS. Local Kong rewrites some CORS headers and does not establish hosted behavior. Never expose the server database URL to a browser or public runtime.
