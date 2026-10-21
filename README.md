# Whakatipu Reforestation Trust

The backend implements planting records in Supabase Postgres with one Deno/Hono Edge Function named `api`. Species, sites, planting areas and planting events all have list, detail, create, full-form update and soft-delete endpoints: 20 domain routes in total.

The code migration from Supabase JS database access and RPCs to Kysely is complete across all 20 routes. The typed database representation, direct queries, transactions, per-endpoint error handling and migration-file cleanup are finished. Runtime verification against the revised schema remains pending.

Authentication is deferred during local development. Requests currently have editor scope, including unpublished active records, and writes use the fixed development audit actor. Database tables remain closed to browser roles. Hosted deployment, Google sign-in, public-view permissions and the historical import script remain future work.

## Repository layout

| Path | Purpose |
| --- | --- |
| [server/](server/README.md) | Local setup, API examples, migrations, logging and checks |
| [server/AGENTS.md](server/AGENTS.md) | Coding patterns and instructions for server changes |
| [shared/api-types.ts](shared/api-types.ts) | Canonical HTTP contracts and primitives; types only |
| [planning/spec.md](planning/spec.md) | Backend specification; its current development increment overrides later target behavior |
| [planning/db-schema.ts](planning/db-schema.ts) | Domain persistence model; versioned migrations define the implemented database |
| [server/supabase/functions/api/database.schema.ts](server/supabase/functions/api/database.schema.ts) | Kysely table representation used by the API's direct Postgres queries |

## Local development

Install Docker, Deno and the Supabase CLI. From the repository root:

```sh
cd server
supabase start
supabase migration up --local
supabase functions serve api
```

The database starts from one consolidated initial migration in `server/supabase/migrations/`.

The API is available at `http://127.0.0.1:54321/functions/v1/api`. Deno resolves pinned dependencies from the function-local configuration and lockfile; there is no separate application build command or Node installation step. See the [server runbook](server/README.md) for environment settings and curl examples.

## Current coding patterns

Use clear, direct TypeScript and Kysely queries. Resource modules perform database calls and explicitly assemble response objects. Keep SQL migrations focused on schema constraints, indexes and privileges. Import shared contracts with `import type`; the Kysely table representation is separate from HTTP response types. Check returned values with `satisfies` and let TypeScript infer function return types.

All resource functions use Kysely over the Supabase-provided transaction-pooled database URL. Kysely and Postgres.js are configured for one connection per Edge isolate with prepared statements disabled. Single-query lists call `db.selectFrom(...)` directly. Related writes use inline `db.transaction().execute(...)`; detail reads use inline repeatable-read transactions. There are no custom transaction or query-execution wrappers. See the [server runbook](server/README.md) for database behavior and log events.

Expected failures include specific client reasons, actionable messages and optional field guidance. Every error body includes the generated request ID. Each endpoint handles query and commit failures in a local `try/catch`, using shared helpers for safe error mapping and log fields. Internal logs retain safe Postgres diagnostics and the original exception's sanitized stack frames/cause chain; raw database messages/details and credentials are omitted.

Requests are assumed to match their TypeScript contracts. There are no application request validators or runtime response schemas. JSON parsing, database constraints and transactional business rules still reject invalid operations. Resource IDs are server-generated. New event-count rows may omit `id` for server generation; retain returned IDs when editing. Area-location inputs still accept supplied IDs. Events accept free-text `season`, and their lists and histories include `image_url`. Species references in totals and event counts are non-null. PUT uses the path ID. All writes preserve audit history and DELETE means soft deactivation.

## Verification

Run from `server/`:

```sh
deno task --config supabase/functions/api/deno.json check
deno task --config supabase/functions/api/deno.json test:workflows
# Full resource and workflow suites:
deno task --config supabase/functions/api/deno.json test
```

Tests use the real local database and Edge Runtime, with every fixture created through HTTP. The runner applies pending migrations without resetting data; suites clean up their fixtures by soft deletion. Run it separately from a manual `functions serve` process. Resource suites exercise collections larger than 1,000 records; the local fresh-worker policy makes the full run take several minutes.

The completed Kysely code migration has passed formatting, lint and TypeScript checks. Regression tests were updated, but tests were not executed and database migrations were not applied during the conversion. The last HTTP suite run predates Kysely; see the [server runbook](server/README.md#checks) for its result. Do not run HTTP tests or apply migrations locally unless James explicitly requests it. Runtime/database behavior, private audit fields, automated database-grant checks, migration replay/recovery, hosted behavior and future auth/public-view rules still need separate verification.
