# Whakatipu Reforestation Trust

The backend implements planting records in Supabase Postgres with one Deno/Hono Edge Function named `api`. Species, sites, planting areas and planting events all have list, detail, create, full-form update and soft-delete endpoints: 20 domain routes in total.

Authentication is deferred during local development. Requests currently have editor scope, including unpublished active records, and writes use the fixed development audit actor. Database tables and privileged RPCs remain closed to browser roles. Hosted deployment, Google sign-in, public-view permissions and the historical import script remain future work.

## Repository layout

| Path | Purpose |
| --- | --- |
| [server/](server/README.md) | Local setup, API examples, migrations, logging and checks |
| [server/AGENTS.md](server/AGENTS.md) | Coding patterns and instructions for server changes |
| [shared/api-types.ts](shared/api-types.ts) | Canonical HTTP contracts and primitives; types only |
| [planning/spec.md](planning/spec.md) | Backend specification; its current development increment overrides later target behavior |
| [planning/db-schema.ts](planning/db-schema.ts) | Domain persistence model; versioned migrations define the implemented database |

## Local development

Install Docker, Deno and the Supabase CLI. From the repository root:

```sh
cd server
supabase start
supabase migration up --local
supabase functions serve api
```

The API is available at `http://127.0.0.1:54321/functions/v1/api`. Deno resolves pinned dependencies from the function-local configuration and lockfile; there is no separate application build command or Node installation step. See the [server runbook](server/README.md) for environment settings and curl examples.

## Current coding patterns

Use clear, direct TypeScript and Postgres code at an advanced graduate level. Resource modules perform database calls and explicitly assemble response objects. Keep SQL focused on constraints, aggregates, locking and atomic nested writes, returning typed rows rather than constructing API JSON. Import shared contracts with `import type`; generated Supabase types describe persistence separately.

Requests are assumed to match their TypeScript contracts. There are no application request validators or runtime response schemas. JSON parsing, database constraints and transactional business rules still reject invalid operations. IDs follow each resource's contract: species/site IDs are server-generated, while area/event creation and new nested area-location/count rows accept supplied IDs. PUT uses the path ID. All writes preserve audit history and DELETE means soft deactivation.

## Verification

Run from `server/`:

```sh
deno task --config supabase/functions/api/deno.json check
deno task --config supabase/functions/api/deno.json test:workflows
# Full resource and workflow suites:
deno task --config supabase/functions/api/deno.json test
```

Tests use the real local database and Edge Runtime, with every fixture created through HTTP. The runner applies pending migrations without resetting data; suites clean up their fixtures by soft deletion. Run it separately from a manual `functions serve` process. Resource suites exercise collections larger than 1,000 records; the local fresh-worker policy makes the full run take several minutes.

The full local run verified on 20 October 2026 passed five suites and 52 test steps, together with formatting, lint, type checks and database lint. This is behavioral integration coverage; private audit fields, automated database-grant checks, migration replay/recovery, hosted behavior and future auth/public-view rules still need separate verification. Use the [server runbook](server/README.md#checks) for all check commands and resource-specific test tasks.
