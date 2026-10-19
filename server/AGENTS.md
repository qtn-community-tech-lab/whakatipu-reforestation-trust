# Server agent instructions

These instructions apply to `server/` and its descendants. Read the relevant source and configuration before changing them. Keep changes focused on the requested behavior and preserve unrelated work.

## Project references and scope

- [Backend specification](../planning/spec.md) is authoritative, including its current development increment. Canonical API types are in `../shared/api-types.ts`. Import them with `import type` through the `@wrt/api-types` alias in the function's `deno.json`; this shared module contains types only. Generated persistence types live in `supabase/functions/_shared/database.types.ts`; keep HTTP contracts separate.
- Species and site CRUD are implemented; planting areas, planting events and authentication are future work. Use `README.md` for local setup and checks.
- Implement the current planting-records release. Do not add future planning, uploads, pagination, multi-tenancy, roles or custom authentication endpoints. Contract changes and paid services require James's direction.

## Current development rules

- No authentication: use the official SDK context with `auth: "none"` and `verify_jwt = false`. All requests have editor scope, including unpublished active data. Future authentication rules below are not active yet.
- Writes use the fixed app user `usr_000000000001`, inserted by the domain migration. There is no separate seed script. Never accept audit identities from a request or create/reactivate the actor at startup. RPCs must check its active state.
- Generate site, new site-location and species IDs with the existing ID helper. Site and species POST/PUT pairs share their editable body shapes. Site location input contains geometry only: update the existing owned location in place, create an ID if unlocated, and detach/deactivate on null. The remaining resource contracts retain their target ID behavior.
- Assume requests match their TypeScript contracts. Do not introduce Zod, manual request/path validation or runtime response schemas. Parse JSON directly; malformed JSON is still 400. Forward only documented editable fields so extra ID/audit values cannot affect persistence. Database constraints remain required.
- Keep the API-only data boundary: browser roles cannot access tables or privileged RPCs even while the Edge handler has no authentication.
- Keep Postgres code as lightweight as possible. Assemble API response objects and nested arrays in TypeScript Edge Function code. This guidance supersedes older specification recommendations to build response JSON in SQL.

## Keep the code simple

- Write at an advanced graduate level: clear, direct code that a graduate developer can understand and maintain. Apply this to TypeScript and SQL/PLpgSQL alike. Prefer named functions, ordinary objects and explicit control flow.
- Give functions one clear responsibility. Use early returns for invalid cases and meaningful names for domain values. Avoid deeply nested conditions and clever one-liners.
- Extract a helper when it removes meaningful repetition or gives a substantial business rule a clear name. A few similar lines do not justify a generic framework.
- Do not introduce base classes, generic CRUD engines, repository interfaces, dependency-injection containers or a separate service for every resource. Add a module or dependency only when current behavior needs it.
- Keep related code together. Separate routing, database operations and response assembly when that makes them easier to follow; avoid chains of functions that only forward arguments. Do not add a request-validation layer.
- Comment on reasons and non-obvious constraints, especially visibility, historical references and transaction locking. Do not narrate obvious code or duplicate the spec in comments.
- Handle expected failures explicitly. Do not swallow errors, return success after failed writes or replace a failed database read with an empty result.

## Runtime and organization

- Use one TypeScript Supabase Edge Function named `api`, running in the Deno-compatible runtime with Hono. Keep the supported `createSupabaseContext<Database>` integration and its privileged client; do not introduce deprecated framework adapters, a separate Node server or additional deployed functions for domain routes.
- Keep the entrypoint in `supabase/functions/api/index.ts`, database changes in `supabase/migrations/`, and operator work in `scripts/`. Add route/helper modules as needed rather than scaffolding empty layers.
- Follow the current modules: `app.ts` constructs Hono middleware/routes; `species.ts` and `sites.ts` perform resource database calls and build DTOs; `responses.ts` shares event-summary and position mapping; `http.ts` parses JSON and maps errors; `config.ts` owns configuration; `logging.ts` creates request loggers; `database.types.ts` refines generated RPC types. Keep `index.ts` as the small handler export.
- Keep request handling independently constructible using ordinary `Request`/`Response` objects.
- Use strict TypeScript, explicit `.ts` extensions for relative TypeScript imports, and `import type` for type-only imports. Avoid `any`, non-null assertions, unchecked casts and compiler suppressions. Narrow uncertain configuration or SDK values without adding runtime validation of HTTP contracts.
- Use the function's `deno.json` for dependency aliases/configuration. Pin dependencies and commit the relevant lockfile; do not introduce a parallel Node toolchain for the API.
- Local serving uses `supabase functions serve api` from `server/`. There is no separate application build task. Keep the root shared contracts type-only: Deno resolves `@wrt/api-types` during checking, and type imports disappear from runtime code. Do not assume runtime imports outside the function directory will work in the local container.
- Read and validate environment configuration in one place. Keep privileged credentials in Edge/operator secrets, never frontend variables or committed `.env` files. Document required settings with placeholder values.

## Contracts and HTTP handling

- Preserve the four named contracts per resource: `*CreateRequest`, `*UpdateRequest`, `*ListResponse`, `*Response`. Site and species create requests are type aliases of their update requests because the server supplies new IDs. Keep the other specified `extends` relationships and nested shapes inline. Do not derive public DTOs with `Omit`, `Pick` or mapped types. Generated database RPC result overrides are separate from these contracts.
- Use the single canonical shared contract module; do not duplicate types in routes. TypeScript contracts are compile-time assumptions, not runtime validation. Keep the generated database file untouched by hand and put necessary RPC result refinements in `api/database.types.ts`, documenting what SQL guarantees that introspection cannot infer.
- Use the generated `Database` with `SupabaseClient<Database>` and explicit `.overrideTypes<..., { merge: false }>()` where introspection cannot express RPC guarantees. Keep these persistence result types separate from public response interfaces. Regenerate persistence types from the migrated local database after schema/function result changes; see `README.md` for the command.
- Use the spec's plural routes: `/sites`, `/planting-areas`, `/species`, `/planting-events`. Locations and event-species rows are nested writes, not independent resources.
- Return plain arrays for lists, direct detail objects for GET/POST/PUT, 201 with a `Location` header on create, and an empty 204 on delete. PUT accepts the complete editable request, not a partial patch or read response.
- Lists return every active record in the specified stable order. Query parameters currently have no effect. Details include complete related arrays. Do not add envelopes, filters, pagination or implicit cutoffs.
- Preserve snake_case JSON, `""` for empty ordinary text and null for missing relationships. IDs are opaque 16-character strings; do not trim or normalize them. Auth UUIDs are separate identity keys.
- Keep calendar dates distinct from timestamps, coordinates longitude-first, and quantity sums within the safe integer range before JSON conversion. Database constraints enforce stored data integrity. Do not fetch image URLs.
- Map expected failures to the spec's status codes and `ErrorResponse`, including sanitized `internal_error` responses. Keep CORS headers on errors, handle OPTIONS before auth, and use `Cache-Control: private, no-store` for viewer-dependent responses. Allow only configured origins.

## Logging and troubleshooting

- Verbose structured logging is the default development pattern. Use `createRequestLog` from `logging.ts`, store it in Hono context and pass it explicitly to resource functions. Do not add a logging framework or global mutable request state.
- Trace request start/completion, JSON parsing, database context setup, operation start/completion, list batches and failures. Use descriptive events such as `species.create.started`, `species.list.batch.completed` and `database.failed`. Include row/event counts and elapsed milliseconds where useful.
- Every line carries a timestamp, level, event, method, path and the server-generated request ID returned as `X-Request-ID`. Include safe resource IDs, trusted audit actor IDs and database error codes. Use `warn` for expected HTTP failures and `error` for database failures or unexpected server failures.
- Never log credentials, headers, query strings, request/response bodies or raw database messages/details that may contain supplied values. Never expose SQL internals or stack traces in API responses. Logging must not inspect request fields in ways that introduce validation or change request behavior.
- Follow a request by its ID and the last stage started before failure. A completed deactivate operation means the idempotent RPC succeeded; it does not imply a newly written timestamp. View live logs with `supabase functions serve api`; the bulk test runner deliberately drains function logs without printing them.

## Authentication and access

- When authentication is implemented, Supabase owns Google OAuth and sessions. Verify access tokens server-side using supported Supabase verification; decoding a JWT or trusting client metadata is insufficient.
- Future authenticated implementation with `verify_jwt = false` must use shared authentication logic: anonymous GETs use public scope; anonymous writes return 401; invalid supplied tokens return 401; valid but unapproved/inactive identities return 403. Never silently downgrade a rejected token to anonymous access.
- Once authentication is implemented, resolve the active app user on every authenticated request. Require trusted Google identity and verified email. First binding uses the spec's canonical-email match and atomic UUID assignment; never auto-create, reactivate or silently rebind an app user.
- Only the API and operator tooling access domain tables/RPCs. Enable RLS on all seven tables and explicitly revoke browser-role and inherited PUBLIC table/function access, including default privileges. Preserve explicit grants as well as RLS.
- Keep the privileged database client separate from caller auth/session state. It bypasses RLS, so every read must explicitly enforce public/editor visibility. Derive actor IDs and viewer scope in trusted server code.
- Construct response DTOs explicitly. Do not serialize database rows wholesale. Apply visibility to nested references, geometry, arrays and aggregates as well as the top-level resource; never send private fields for the client to hide.

## Postgres and business rules

- Use versioned SQL migrations for tables, constraints, indexes, privileges and functions. Make new migrations for changes to an applied schema; do not rely on dashboard-only SQL. Combine unreleased migrations only when James directs it, preserving the final schema and reconciling local history where needed without resetting data. Keep migration execution separate from request handling.
- Prefer ordinary typed Supabase queries for straightforward reads and writes. Use small `.rpc()` database functions when transactions, locking or aggregate queries require them. Separate SDK writes do not share a transaction. Parameterize values and keep constraints and transactional integrity in Postgres.
- Keep database functions focused on fetching rows, calculating aggregates and performing atomic writes. Return typed rows or small result sets for TypeScript to turn into public DTOs. Avoid SQL helpers whose only purpose is building nested API JSON; JSONB remains appropriate for stored JSON data such as geometry.
- The current species/site pattern uses ordinary batched table queries for lists and four RPCs per resource for detail/create/update/deactivate. Detail RPCs return the resource row, aggregates and typed arrays of related rows in one result; TypeScript builds nested summaries. Keep saved detail data in the write transaction rather than fetching it again after commit.
- Keep RPCs security-invoker, qualify relations, set an empty search path and grant execution explicitly to `service_role` only. Runtime table grants remain SELECT/INSERT/UPDATE; preserve RLS and closed default privileges.
- Write Postgres functions as straightforward steps with descriptive names. Use joins, subqueries and CTEs only where they clarify the query or preserve correctness; avoid unnecessary custom types, nested queries, dynamic SQL and helper-function chains. Keep required locking, audit checks and transaction guarantees explicit. Choose the simplest approach that preserves the required behavior.
- Inside write transactions, recheck the active actor and referenced records, lock affected rows in a consistent order, and serialize saves to the same parent. Return the saved rows and related data needed to assemble the response in TypeScript, preserving a consistent view of the saved operation. Do not add optimistic versioning to the specified last-committed-save behavior.
- Save owner/location changes and event/count desired sets atomically. Preserve existing nested IDs and creation fields; deactivate omitted count rows. Enforce location ownership across both sites and areas and prevent count rows from moving between events. Follow spec section 11 for nested-row reactivation and inactive-reference exceptions.
- Set audit actors from the app user's domain ID and timestamps in trusted server/database code. A nested geometry/count change must update its parent's audit fields too. Do not add a separate audit-event system.
- DELETE means soft deactivation. Preserve historical rows and references, and preserve the original timestamp on repeated accessible deletes. Site deactivation hides children without cascading deactivation to their stored rows.
- Keep historical inactive species/area references editable as specified while rejecting new inactive links. Inactive species quantities still contribute to actual totals.
- Calculate aggregates independently of joins that could multiply rows. Use a consistent read snapshot for a detail's histories and totals. Check sums before converting them to JavaScript numbers; unsafe totals are conflicts, never rounded values.
- Public events depend on their site's visibility, not their area's. Hide private/inactive area identity and geometry and apply the site-location fallback. Combine hidden species quantities into the specified null group without leaking original line IDs or catalogue identities.
- Guarantee complete reads despite Supabase's Data API row limit. Species and site lists use ordered internal batches, advance by the actual returned count and continue until an empty batch; do not stop simply because a batch is smaller than requested. Use a focused read RPC where a consistent snapshot is required. A plain `.select()` is not evidence of completeness, and internal batching is not public pagination.

## Development checks

- Maintain species and site end-to-end tests in `tests/species_test.ts` and `tests/sites_test.ts` using Deno's built-in runner and the real local Supabase database and Edge Runtime. Create every test fixture through the implemented HTTP APIs; do not seed related records through SQL or the Data API. Non-zero event history/totals coverage waits for those resource endpoints. Avoid mocks and additional test frameworks. Planting area/event test suites remain deferred until those endpoints are requested. Share HTTP assertions and bounded batching in `tests/http.ts`, keeping resource fixtures explicit. Site tests also cover location attachment, in-place geometry edits, detach/reattach, ignored nested IDs, transactional rollback and concurrent complete saves.
- Run `deno task --config supabase/functions/api/deno.json test` from `server/` for all implemented HTTP suites; `test:species` and `test:sites` select a single resource. The shared runner `scripts/test-api.ts` starts Supabase, applies pending migrations and serves the API. Never reset the working database; soft-delete only records created by the suite. Keep local Supabase credentials out of logs.
- Keep tests explicit: send HTTP requests and assert status, headers and complete response bodies. Cover CRUD, ignored ID/audit inputs, constraint rollback, malformed JSON, unknown/inactive records, unpublished records, stable ordering and lists exceeding 1,000 records. Use unique run names, track created IDs, bound concurrency and clean up in `finally`. Soft-deleted test rows remain as local history; leave unrelated data untouched.
- Use formatting, lint and TypeScript checks appropriate to the change. From `server/`:

  ```sh
  deno fmt --check supabase/functions tests scripts ../shared ../planning/db-schema.ts
  deno lint --config supabase/functions/api/deno.json supabase/functions tests scripts ../shared ../planning/db-schema.ts
  deno task --config supabase/functions/api/deno.json check
  ```

- The `check` task includes the application, HTTP tests and test runner. Run the affected suites after endpoint behavior changes and both suites when shared handling changes; do not add tests that merely mirror implementation details or repeat expensive checks without a reason.
- Database lint is appropriate when changing SQL. Never reset working data to check a change.
- Documentation-only changes need content review rather than an application build.
- Report which checks actually ran and any failures or material gaps. Do not claim runtime or database behavior was tested when only static checks ran.
- The current local Kong plugin handles preflight with 200 instead of Hono's 204 and rewrites Allow-Origin to `*`. Keep this platform difference documented rather than changing generated gateway configuration. Local gateway checks do not establish hosted CORS behavior.

## Operator scripts

- Keep editor provisioning and historical import outside the public API. Reuse validation and transactional rules rather than creating a second write path with weaker checks.
- Imports need a write-free dry run, durable source-to-domain ID mapping, private-by-default publication and reconciliation reports. Reruns must not duplicate or blindly overwrite records. Report unknown dates, types, species and quantities rather than inventing values.
- Document migrations, deployment, secrets, editor deactivation and export/restore procedures as they are implemented. Use local/test data for recovery rehearsals and review current platform limits before deployment; do not introduce paid infrastructure without James's approval.
