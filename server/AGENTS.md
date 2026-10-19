# Server agent instructions

These instructions apply to `server/` and its descendants. Read the relevant source, configuration and tests before changing them. Keep changes focused on the requested behavior and preserve unrelated work.

## Project references and scope

- [Backend specification](../planning/spec.md) is authoritative for architecture, behavior and acceptance requirements. Use [API types](../planning/api-types.ts) and [database rows](../planning/db-schema.ts) alongside it.
- The database type comments still describe server-supplied IDs and passwordless auth, and `User` lacks `auth_user_id`. Follow the spec's caller-supplied IDs, Google/Supabase Auth and UUID mapping when implementing the database.
- The existing function and Supabase configuration are starter scaffolding, not an implemented API or an alternative specification.
- Implement the current planting-records release. Do not add future planning, uploads, pagination, multi-tenancy, roles or custom authentication endpoints. Contract changes and paid services require James's direction.

## Keep the code simple

- Write clear, direct code that a smart graduate developer can understand and maintain. Prefer named functions, ordinary objects and explicit control flow.
- Give functions one clear responsibility. Use early returns for invalid cases and meaningful names for domain values. Avoid deeply nested conditions and clever one-liners.
- Extract a helper when it removes meaningful repetition or gives a substantial business rule a clear name. A few similar lines do not justify a generic framework.
- Do not introduce base classes, generic CRUD engines, repository interfaces, dependency-injection containers or a separate service for every resource. Add a module or dependency only when current behavior needs it.
- Keep related code together. Separate routing, validation and database operations when that makes them easier to follow; avoid chains of functions that only forward arguments.
- Comment on reasons and non-obvious constraints, especially visibility, historical references and transaction locking. Do not narrate obvious code or duplicate the spec in comments.
- Handle expected failures explicitly. Do not swallow errors, return success after failed writes or replace a failed database read with an empty result.

## Runtime and organization

- Use one TypeScript Supabase Edge Function named `api`, running in the Deno-compatible runtime. A small router such as Hono is sufficient. Do not add a Node/Fastify server or additional deployed functions for domain routes.
- Keep the entrypoint in `supabase/functions/api/index.ts`, database changes in `supabase/migrations/`, and operator work in `scripts/`. Add route/helper modules and tests as needed rather than scaffolding empty layers.
- Keep request handling callable without starting a listener so HTTP behavior can be tested with ordinary `Request`/`Response` objects.
- Use strict TypeScript, explicit `.ts` extensions for relative TypeScript imports, and `import type` for type-only imports. Avoid `any`, non-null assertions, unchecked casts and compiler suppressions; validate or narrow uncertain values.
- Use the function's `deno.json` for dependency aliases/configuration. Pin dependencies and commit the relevant lockfile; do not introduce a parallel Node toolchain for the API.
- Read and validate environment configuration in one place. Keep privileged credentials in Edge/operator secrets, never frontend variables or committed `.env` files. Document required settings with placeholder values.

## Contracts and HTTP handling

- Preserve the four interfaces per domain resource: `*CreateRequest`, `*UpdateRequest`, `*ListResponse`, `*Response`. Use `extends` for their specified reuse and keep small nested shapes inline. Do not derive public DTOs with `Omit`, `Pick` or mapped types.
- Share the implemented contracts between client and server in one agreed module. Keep runtime validators aligned with those interfaces; TypeScript alone does not validate JSON. Use explicit validators or a small maintained library, not a custom validation framework.
- Use the spec's plural routes: `/sites`, `/planting-areas`, `/species`, `/planting-events`. Locations and event-species rows are nested writes, not independent resources.
- Return plain arrays for lists, direct detail objects for GET/POST/PUT, 201 with a `Location` header on create, and an empty 204 on delete. PUT accepts the complete editable request, not a partial patch or read response.
- Lists accept no query parameters and return every visible matching record in the specified stable order. Details include complete scoped related arrays. Do not add envelopes, filters, pagination or implicit cutoffs.
- Reject unknown fields, missing required fields, invalid types and unexpected query parameters. Validate path IDs as well as bodies. Reject caller-supplied audit fields and actor/viewer scope.
- Preserve snake_case JSON, `""` for empty ordinary text and null for missing relationships. IDs are opaque, caller-supplied 16-character strings; validate as specified without trimming or normalizing them. Auth UUIDs are separate identity keys.
- Validate actual calendar dates without timezone conversion, finite non-negative safe integer quantities, and longitude-first Point coordinates. Reject Polygon input in this release. Image URLs are HTTPS or `""`; do not fetch them.
- Map expected failures to the spec's status codes and `ErrorResponse`, including sanitized `internal_error` responses. Keep CORS headers on errors, handle OPTIONS before auth, and use `Cache-Control: private, no-store` for viewer-dependent responses. Allow only configured origins.
- Log safe request identifiers and error context without tokens, secrets or full private request/response bodies. Never expose SQL internals or stack traces in API responses.

## Authentication and access

- Supabase owns Google OAuth and sessions. Verify supplied access tokens server-side using supported Supabase verification; decoding a JWT or trusting client metadata is insufficient.
- With `verify_jwt = false`, every domain route must still use shared authentication logic: anonymous GETs use public scope; anonymous writes return 401; invalid supplied tokens return 401; valid but unapproved/inactive identities return 403. Never silently downgrade a rejected token to anonymous access.
- Resolve the active app user on every authenticated request. Require trusted Google identity and verified email. First binding uses the spec's canonical-email match and atomic UUID assignment; never auto-create, reactivate or silently rebind an app user.
- Only the API and operator tooling access domain tables/RPCs. Enable RLS on all seven tables and explicitly revoke browser-role and inherited PUBLIC table/function access, including default privileges. Test grants as well as RLS.
- Keep the privileged database client separate from caller auth/session state. It bypasses RLS, so every read must explicitly enforce public/editor visibility. Derive actor IDs and viewer scope in trusted server code.
- Construct response DTOs explicitly. Do not serialize database rows wholesale. Apply visibility to nested references, geometry, arrays and aggregates as well as the top-level resource; never send private fields for the client to hide.

## Postgres and business rules

- Use versioned SQL migrations for tables, constraints, indexes, privileges and functions. Make new migrations for changes to an applied schema; do not rely on dashboard-only SQL. Keep migration execution separate from request handling.
- Use Supabase `.rpc()` database functions for atomic multi-row operations. Separate SDK writes do not share a transaction. Parameterize values and enforce integrity in Postgres as well as at the API boundary.
- Inside write transactions, recheck the active actor and referenced records, lock affected rows in a consistent order, and serialize saves to the same parent. Return the full saved detail from that operation. Do not add optimistic versioning to the specified last-committed-save behavior.
- Save owner/location changes and event/count desired sets atomically. Preserve existing nested IDs and creation fields; deactivate omitted count rows. Enforce location ownership across both sites and areas and prevent count rows from moving between events. Follow spec section 11 for nested-row reactivation and inactive-reference exceptions.
- Set audit actors from the app user's domain ID and timestamps in trusted server/database code. A nested geometry/count change must update its parent's audit fields too. Do not add a separate audit-event system.
- DELETE means soft deactivation. Preserve historical rows and references, and preserve the original timestamp on repeated accessible deletes. Site deactivation hides children without cascading deactivation to their stored rows.
- Keep historical inactive species/area references editable as specified while rejecting new inactive links. Inactive species quantities still contribute to actual totals.
- Calculate aggregates independently of joins that could multiply rows. Use a consistent read snapshot for a detail's histories and totals. Check sums before converting them to JavaScript numbers; unsafe totals are conflicts, never rounded values.
- Public events depend on their site's visibility, not their area's. Hide private/inactive area identity and geometry and apply the site-location fallback. Combine hidden species quantities into the specified null group without leaking original line IDs or catalogue identities.
- Guarantee complete reads despite Supabase's Data API row limit. Prefer read RPCs that assemble one JSON array/object in SQL; a plain `.select()` is not evidence of completeness.

## Tests and checks

- Test observable behavior and meaningful failure cases. Use focused Deno tests for validation, visibility/serialization and HTTP behavior. Avoid tests that merely repeat implementation details or mock SDK query chains.
- Use real non-production Supabase/Postgres integration checks for constraints, grants, RPC rollback, identity-binding races and concurrent saves. Mocks cannot prove those invariants. Follow the acceptance matrix in spec section 16.
- Include public/private/inactive fixtures, historical references, hidden-species totals, zero/empty events and more than 1,000 records. Check that browser credentials cannot bypass the API through tables or RPCs.
- Keep unit tests deterministic and independent of live credentials. Make integration targets explicit and keep fixtures out of production. Never run a destructive database reset against a linked production project.
- Run relevant formatting, lint, type and test checks for executable changes. From `server/`, the API checks are:

  ```sh
  deno fmt --check supabase/functions/api
  deno lint supabase/functions/api
  deno check --config supabase/functions/api/deno.json supabase/functions/api/index.ts
  ```

- Add documented Deno test and database integration commands alongside their suites when implemented; do not imply they already exist. Check scripts/shared code when affected. Documentation-only changes need content review, not an application build.
- Report what changed, which checks ran and any material gaps or existing failures. Do not claim database, hosted-runtime or OAuth behavior is verified by unit tests alone.

## Operator scripts

- Keep editor provisioning and historical import outside the public API. Reuse validation and transactional rules rather than creating a second write path with weaker checks.
- Imports need a write-free dry run, durable source-to-domain ID mapping, private-by-default publication and reconciliation reports. Reruns must not duplicate or blindly overwrite records. Report unknown dates, types, species and quantities rather than inventing values.
- Document migrations, deployment, secrets, editor deactivation and export/restore procedures as they are implemented. Use local/test data for recovery rehearsals and review current platform limits before deployment; do not introduce paid infrastructure without James's approval.
