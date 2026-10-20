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

All resource queries use a shared TypeScript helper for database timing and error logging. All 16 SQL functions also log named stages, completion outcomes and failures, correlated with Edge logs through the response's `X-Request-ID`. See the [server runbook](server/README.md#endpoints) for log events and PostgreSQL troubleshooting.

Expected failures include specific client reasons, actionable messages and optional field guidance. Every error body includes the generated request ID. Internal logs retain PostgreSQL exception context and TypeScript stack frames/cause chains; raw database messages/details and credentials are omitted from these diagnostics. The reasons and stack-logging changes have static verification only; no local tests or migrations were run for them.

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

The contract-update verification on 20 October 2026 passed all 14 planting-event steps and the static/database checks. The full HTTP run had 36 passing and 17 failing steps as the local Docker/Supabase stack became unavailable; fixture cleanup remains incomplete. Local migration history has since been reconciled. The initial planting-event diagnostics passed formatting, lint and type checks, and a targeted HTTP check verified correlated Edge/SQL failure logs. A subsequent full HTTP run was stopped at James's request; there is no new full-suite result. The expansion to all 16 SQL functions has had static source review only. Do not run tests locally unless explicitly requested. Private audit fields, automated database-grant checks, migration replay/recovery, hosted behavior and future auth/public-view rules still need separate verification. Use the [server runbook](server/README.md#checks) for all check commands and resource-specific test tasks.
