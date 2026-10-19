---
id: SPEC-wrt-backend
project: Whakatipu Reforestation Trust
updated: 2026-10-19
status: implementation handoff draft
companions: []
sources:
  - ../database-tables.ts
  - ../database-tables.md
  - ../api-contracts.ts
  - ../api-contracts.md
---

# WRT backend specification: Supabase, Google OAuth and planting records

**Audience:** backend developer, with frontend integration notes.

**Build:** one Supabase project providing Google authentication, Postgres persistence and one TypeScript Edge Function containing the application's REST API. Use database functions for transactional multi-table changes. Prefer the free tier and do not introduce paid services without James's approval.

This is a self-contained implementation handoff. The database structure, HTTP behavior, TypeScript contracts, business rules and acceptance requirements are included below. Other files are provenance, not required reading. No backend implementation, deployment, client sign-off or delivery deadline is implied by this document.

## Current development increment: species and site APIs

The following agreed development choices take precedence over the later target behavior in this document for the implemented species and site endpoints:

- Run locally in the Supabase `api` Edge Function, with Deno, Hono and the official Supabase server SDK. Hosted deployment is later work.
- Species and site HTTP end-to-end tests are maintained against local Supabase using Deno's built-in runner. Create all fixtures through the implemented HTTP endpoints and clean up by soft deletion; do not reset local data. Non-zero histories/totals tests wait for related resource endpoints. Other suites and the wider acceptance matrix below remain future guidance unless requested.
- Authentication is deferred. Requests need no bearer token or API key at the handler. Every request has editor scope: all active species, sites and otherwise active related records are visible regardless of publication flags.
- Use the seeded app user `usr_000000000001` for every write's audit identity. This is a local development identity, not a Supabase Auth account. RPCs still check that the actor is active.
- The server generates site, new site-location and species IDs. Site and species create requests alias their corresponding update requests and omit IDs. Site location input is `{ geometry }` or null; PUT retains an existing location ID, creates one if needed, or detaches/deactivates on null. Area and event create contracts remain the future target described below.
- Assume requests match the TypeScript contracts. Do not add Zod, replacement request validators, path-ID validators or response-schema validators. JSON parsing failures return 400; existing database constraints remain enforced. Extra request properties are ignored, never forwarded as audit or ID values. Query parameters have no effect and do not add filtering.
- Retain the full species and site detail contracts, including real totals and complete related summaries. Site details include owned geometry, per-species quantities, active planting areas and event history. Preserve soft deactivation, audit history, safe aggregate limits and the server-only table/RPC access boundary.
- Keep Postgres functions lightweight: use typed queries for catalogue lists and small RPCs for consistent detail reads, aggregates and transactional writes. Assemble public response objects in TypeScript, not SQL JSON builders. This takes precedence over older SQL response-assembly recommendations below.

Canonical contracts are in [the monorepo shared module](../shared/api-types.ts), imported by Deno through the function's `@wrt/api-types` alias using `import type`. [The server runbook](../server/README.md) describes the current implementation, checks and local gateway behavior. The wider acceptance matrix below remains the target for resources and authentication not yet implemented.

## Contents

1. [Why](#1-why)
2. [Capabilities](#2-capabilities)
3. [Constraints and authoritative decisions](#3-constraints-and-authoritative-decisions)
4. [Non-goals](#4-non-goals)
5. [Success signal](#5-success-signal)
6. [Architecture and business logic](#6-architecture-and-business-logic)
7. [Google authentication and editor access](#7-google-authentication-and-editor-access)
8. [Database specification](#8-database-specification)
9. [REST API](#9-rest-api)
10. [Complete TypeScript API contracts](#10-complete-typescript-api-contracts)
11. [Write transactions and lifecycle](#11-write-transactions-and-lifecycle)
12. [Read models, publication and totals](#12-read-models-publication-and-totals)
13. [Validation and errors](#13-validation-and-errors)
14. [Historical import](#14-historical-import)
15. [Development, deployment and operation](#15-development-deployment-and-operation)
16. [Acceptance and developer deliverables](#16-acceptance-and-developer-deliverables)
17. [Assumptions and launch inputs](#17-assumptions-and-launch-inputs)
18. [Sources and superseded material](#18-sources-and-superseded-material)

## 1. Why

WRT needs reliable actual planting records that staff can find, correct and selectively publish. The backend must replace scattered operational records with a consistent source of truth for sites, species, planting dates and quantities, while serving a simple public map and planting history. Keep this release small: actual records first, not a general restoration-management platform.

## 2. Capabilities

| ID    | Intent                                                                                   | Success                                                                                                                                                      |
| ----- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CAP-1 | Approved WRT editors can sign in with their Google accounts.                             | An approved active account can read operational records and edit; an unapproved Google account cannot. No app passwords or emailed login links are required. |
| CAP-2 | Editors can maintain sites, optional planting areas, species and actual planting events. | Creates, complete-form updates and soft deletion persist correctly, including owned locations and event species/count rows.                                  |
| CAP-3 | Visitors can browse approved records without signing in.                                 | Public lists, map pins and detail/history responses expose only effectively published data and never private nested references.                              |
| CAP-4 | Users can retrieve display-ready details and explainable actual totals.                  | Details include complete related arrays; counts reconcile to active source rows without join multiplication or loss of historical quantities.                |
| CAP-5 | WRT's existing historical records can be imported once and reconciled.                   | An operator can preview, validate, import and safely rerun the import without duplicating records or inventing missing facts.                                |

## 3. Constraints and authoritative decisions

- Supabase Auth, Google OAuth only. No custom magic-link service, app password system, email provider or token issuer.
- One TypeScript Edge Function named `api`, using Supabase's Deno-compatible runtime. No separate Node server, VM or second backend host.
- Supabase Postgres. Seven application/domain tables: `users`, `sites`, `planting_areas`, `locations`, `species`, `planting_events`, `planting_event_species`. Supabase's managed `auth` tables are additional platform infrastructure, not application tables.
- Four domain CRUD resources: sites, planting areas, species and planting events. Locations and count rows are owned nested writes, not independent HTTP resources.
- Four named contracts per domain resource (site and species create requests are aliases): `*CreateRequest`, `*UpdateRequest`, `*ListResponse`, `*Response`. Reuse through `extends`; no `Omit`, `Pick` or mapped DTO derivation. Define small nested objects inline.
- Lists return complete plain arrays. No list filtering, pagination, cursors, `include` machinery or response envelope. Search and filtering happen in the client. Visibility is always enforced on the server.
- Detail responses include complete scoped related arrays, not initial history pages or recursive nested detail objects.
- Retain 16-character string domain IDs. Site, new site-location and species IDs are generated by the server; area/event target create contracts still accept supplied IDs, including their nested records. Supabase Auth UUIDs are mapped separately, not substituted for domain IDs.
- JSON fields use snake_case. Optional ordinary text is `""`, not null. Genuine missing relationships are null.
- One `image_url: string` on species and events. No image arrays, image table, upload API or photo capture-date field in this release.
- One required exact `planting_date`, not separate year/season/precision columns.
- Phase 1 location input is a GeoJSON Point. The shared geometry type leaves room for future polygons; polygon submission/editing is not enabled in this release.
- DELETE means soft deactivation. Preserve audit identities and historical relationships. No hard-delete HTTP endpoints.
- No custom session, OAuth callback, refresh-token or logout endpoints. Supabase owns its authentication protocol; the application's OAuth return page is a frontend route.
- Online-only, single WRT organisation. No multi-tenant abstraction added in anticipation of later phases.

### 3.1 Precedence

Use this document for this Supabase implementation. It incorporates James's latest direction and the current domain TypeScript contracts, with the explicitly identified auth/schema adjustments below. Older prose about magic links, image arrays, custom token expiry, unselected database storage or pagination is superseded. The wider roadmap remains context for later work, not permission to expand this release.

## 4. Non-goals

- Future planting plans, density/spacing calculations, forecasting and nursery demand or stock management.
- TTC integration, TTC import/export, continuous synchronization and structured survival monitoring.
- Polygon editing, walked boundaries, device accuracy/source metadata or survey-grade positioning.
- Fixed photo points, chronological photo sequences, image processing or file uploads.
- Offline support, background synchronization or realtime collaboration.
- Other organisations, memberships, organisational roles, billing or bespoke themes.
- App-based user administration, permission hierarchies, restoration UI or independent Location/count-row CRUD.
- Event-sourcing, immutable revision history, optimistic concurrency or a generic workflow engine. Basic audit columns are not a revision-history system.

## 5. Success signal

An approved WRT editor can independently find, create and correct a planting event, then publish it. The returned species quantities and site totals reconcile to the reviewed records. An anonymous visitor sees only approved content. A rejected or deactivated editor cannot change data even by bypassing the frontend.

## 6. Architecture and business logic

### 6.1 Request flow

```text
Browser -> Supabase Auth <-> Google
Browser -> /functions/v1/api/<resource> -> TypeScript handler -> Postgres
                                                   |
                                                   +-> database function for atomic saves
```

The browser receives a Supabase session after Google sign-in. It sends the Supabase access token, not Google's token, to the WRT API. Public GET requests omit the bearer token.

Supabase hosts server-side TypeScript Edge Functions and supports multiple REST routes inside one function. A small router such as Hono is sufficient; do not introduce a full application framework. [Edge Functions](https://supabase.com/docs/guides/functions), [routing](https://supabase.com/docs/guides/functions/routing).

### 6.2 Division of responsibility

| Layer            | Responsibility                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend         | Google sign-in/return flow through the Supabase SDK; client search/filter; forms; clear private caches on sign-out.                                 |
| Edge API         | Authenticate requests; resolve approved editor; validate JSON; choose public/editor scope; route commands; map errors; return explicit DTOs.        |
| Postgres         | Persist rows; enforce foreign keys, uniqueness and lifecycle invariants; execute transactional saves; calculate actual totals and joined read data. |
| Operator scripts | Provision/deactivate approved users; run reviewed historical import and database export procedures.                                                 |

Do not build a universal repository layer, an independent service per resource or one deployed function per HTTP verb. Keep route handlers small and shared logic explicit.

### 6.3 Database functions

Use SQL/PLpgSQL functions callable from the Edge Function with `.rpc()` when one logical change touches several rows. A single RPC request runs in a database transaction: uncaught errors roll it back. Separate `.insert()`/`.update()` HTTP calls do not share that transaction. [Database functions](https://supabase.com/docs/guides/database/functions), [PostgREST transactions](https://docs.postgrest.org/en/v13/references/transactions.html).

Required atomic operations include saving a site/area and its location, saving an event and its entire species/count set, and deactivating an owner and its location. Function names and internal signatures are implementation details, not extra public API contracts.

The API validates before calling a function, but essential integrity rules must also hold inside the transaction. For writes, resolve/recheck the active actor, lock affected existing rows and validate referenced records before mutation. Use consistent lock ordering. Serialize concurrent edits to the same parent so their nested desired sets cannot interleave. Last committed valid save wins; no version field is required.

Return the created/updated detail representation from the same transactional operation so the response describes the committed save rather than a later, unrelated read.

### 6.4 Database access boundary: API-only domain access

**Implementation default:** only the Edge API and operator tooling access application tables/functions. The frontend uses Supabase for Auth, not raw domain-table CRUD.

- Enable RLS on all seven application tables, but create no browser-facing table policies for this implementation.
- Explicitly revoke application-table access from `anon` and `authenticated`, and any inherited `PUBLIC` privileges. Review default grants for newly created objects too.
- Revoke application-function execution from `PUBLIC`, `anon` and `authenticated`. Grant only the server/service role the required table and RPC privileges.
- Keep the privileged key in Edge secrets only. Use a separate server database client with no browser session persistence or caller Authorization header applied to it.
- That client bypasses RLS. Therefore the API/read SQL must explicitly enforce viewer scope; RLS is not automatically protecting privileged queries.
- RPC actor IDs and viewer scopes are derived by trusted server code, never accepted from HTTP request fields. Write RPCs check that the supplied internal actor is an active app user.
- Test direct browser table reads/writes and RPC calls: both must fail, including for an approved editor's user token. Editors must go through the API so aggregate invariants cannot be bypassed.

This is one consistent access model. Do not also expose unrestricted Supabase table CRUD alongside it. Supabase distinguishes grants from RLS, and existing projects may grant broad default privileges. [Data API security](https://supabase.com/docs/guides/api/securing-your-api).

### 6.5 Mixed public and authenticated routes

Because the same deployed `api` function serves anonymous GETs and authenticated operations, anonymous requests must reach the handler. Configure its platform JWT requirement accordingly:

```toml
[functions.api]
verify_jwt = false
```

This moves token verification into the API; it does not make writes public. Run shared auth middleware before every domain handler:

1. No Authorization header: public scope for GET; reject writes with 401.
2. Supplied malformed/invalid/expired token: 401, never silently downgrade to public.
3. Valid token: verify the Google identity and active WRT allowlist mapping; reject unapproved/inactive users with 403.
4. Approved active user: editor scope.

Use Supabase's supported server verification, for example `auth.getUser(accessToken)`, not a base64-decoded JWT or browser `getSession()` result as proof. Treat verification-service failures as server failures, not permission to proceed. Handle OPTIONS before auth. [Function authentication](https://supabase.com/docs/guides/functions/auth), [server-side getUser](https://supabase.com/docs/reference/javascript/auth-getuser).

## 7. Google authentication and editor access

### 7.1 Configure OAuth

Create a Google OAuth web application under an agreed project owner. Register Supabase's callback URL from its dashboard with Google. Configure the Google client ID/secret in Supabase Auth, enable Google and disable email/password/passwordless and other login methods. Configure the application Site URL and exact approved return URLs for local development and production. Do not request Gmail, Drive, Calendar or other unrelated scopes. [Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google).

The frontend can start login with:

```ts
await supabase.auth.signInWithOAuth({
  provider: "google",
  options: { redirectTo: `${window.location.origin}/auth/callback` },
});
```

Use the SDK's supported browser OAuth flow end to end. For a PKCE client, exchange the returned code using `exchangeCodeForSession`; do not invent a WRT callback-token API. Restrict redirect destinations and clean callback parameters after processing. Google credentials never go into the frontend bundle.

### 7.2 Authentication is not authorisation

An active row in the application's `users` table is the WRT editor allowlist. All such users have the same editing permission. No roles/membership table is required.

An arbitrary Google user may be able to create a managed Supabase Auth identity. That must not create a WRT app user or confer access. Do not globally disable first-time OAuth identity creation if doing so prevents approved staff's initial sign-in. The business allowlist is the authority. A Google account picker/domain hint is not an authorisation check.

### 7.3 Map Supabase UUIDs to existing app IDs

Add one integration column to the existing app `users` table:

```sql
auth_user_id uuid null unique references auth.users(id) on delete restrict
```

`users.id` remains the 16-character app ID referenced by audit columns. The managed `auth.users.id` UUID is an identity key only. Do not change every domain/audit ID to UUIDs to accommodate Auth.

Provision editor app rows outside the public API, with supplied domain ID, approved email, display name and audit values. Binding can be pre-provisioned or completed on the first verified authorised request:

1. Validate the Supabase token with the Auth service. Require a verified email and Google identity using trusted Auth data, not arbitrary `user_metadata` or client input.
2. Look up an active app row already bound to this Auth UUID. If found, use its app ID as actor. A later email change must not grant another app identity.
3. Otherwise look up an active unbound app user by the verified canonical email: trim surrounding whitespace and lowercase consistently. Do not invent Gmail dot/plus-address equivalence.
4. Atomically bind the UUID only if still unbound. The app row and UUID are unique; concurrent binding cannot overwrite another identity.
5. If no active match exists, or the row is bound to a different UUID, return 403. Do not auto-create the app row, reactivate it or silently rebind it.

Email is the bootstrap match, not the permanent authorisation identifier. Binding updates that app user's audit fields. Operator review is required for account replacement. Recheck the app row's active state on every authenticated request, not just at login. Deactivation takes effect on the next request even when the Supabase session still exists.

### 7.4 Sessions, logout and frontend contract

Let the Supabase SDK own access/refresh tokens, persistence and refresh. The previous custom eight-hour bearer-token policy is removed. Do not issue duplicate WRT JWTs or store Google provider tokens as app credentials.

There is no WRT `/session`, `/auth/callback`, `/auth/magic-link` or `/auth/logout` endpoint. The frontend uses Supabase session/user types, and discovers whether the session is authorised from the API's authenticated responses. A Supabase user alone is not proof of WRT editor permission.

For sign-out, use the SDK's current-session sign-out and clear all cached operational data and pending private form state. SDK sign-out may call Supabase's own Auth service; it does not require an application logout endpoint. Do not delete a single local-storage field while leaving the SDK's refresh session active. Access tokens are not guaranteed to become immediately unusable merely because the UI signed out. [SDK sign-out](https://supabase.com/docs/reference/javascript/auth-signout).

A user with a rejected/inactive app account may still browse public data by signing out and making requests without the rejected bearer token. Public preview also omits the token; it is not a query parameter.

## 8. Database specification

### 8.1 Common types and defaults

| Concept         | Postgres storage / rule                                                                                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Domain ID       | `text`, case-sensitive non-normalising comparison, `char_length(id) = 16`; primary key. Do not use padded `char(16)`.   |
| Audit timestamp | `timestamptz`, required except `deactivated_at`; serialize as UTC ISO 8601.                                             |
| Planting date   | `date`, required; restrict to years 1 through 9999; serialize as `YYYY-MM-DD`.                                          |
| Ordinary text   | `text not null`; descriptions/notes/image URLs default to `''`; names/email must be nonblank.                           |
| Publication     | `boolean not null default false`.                                                                                       |
| Aliases         | `text[] not null default '{}'`; no null array elements.                                                                 |
| Geometry        | `jsonb not null`, one GeoJSON geometry object; Phase 1 accepts Point only. No PostGIS dependency required for pins.     |
| Quantity        | `bigint not null`, constrained to 0 through 9007199254740991. Validate JSON integer semantics before any database cast. |
| Event type      | constrained text or Postgres enum: `establishment`, `infill`, `replacement`.                                            |

Treat IDs as opaque: no trimming, case-folding or Unicode normalization. Reject malformed Unicode/NUL and values not exactly 16 Unicode characters; match JS validation to Postgres character counting. For new IDs, the frontend/operator may use a maintained URL-safe random-ID library configured to length 16. Site and species APIs generate their IDs with the shared helper, including new site locations; area/event target endpoints still accept supplied IDs. An ID collision is an error, not an instruction to update.

### 8.2 Shared editable-row columns

Every application table, including `users`, `locations` and count rows, contains:

| Column           | Type                              | Meaning                                                                 |
| ---------------- | --------------------------------- | ----------------------------------------------------------------------- |
| `id`             | domain ID PK                      | Supplied stable identifier.                                             |
| `created_by`     | domain ID FK `users.id`, not null | App user performing insertion/import, not the person who planted trees. |
| `created_at`     | timestamptz, not null             | Server/database creation instant.                                       |
| `updated_by`     | domain ID FK `users.id`, not null | Actor performing the latest mutation.                                   |
| `updated_at`     | timestamptz, not null             | Set on insertion and every mutation.                                    |
| `deactivated_at` | timestamptz, nullable             | Null means active; otherwise soft-deactivated.                          |

Set both actor columns on insert and both timestamps to the same transaction time. Creation fields never change. Update/deactivate operations refresh update fields. Enforce `updated_at >= created_at`; never accept audit fields from HTTP input. Preserve FK targets rather than deleting users.

The first operator-provisioned app user may self-reference its supplied ID for both audit FKs. Further user provisioning uses an existing authorised operator identity. Historical imports use the actual importing app user. No system write may omit an audit actor or fabricate the original planter identity.

### 8.3 Table-specific columns

All columns below are additional to the shared columns.

| Table                    | Columns and relationships                                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                  | `email text not null`, canonical and globally unique across active/inactive rows; `display_name text not null`; `auth_user_id uuid null unique` FK managed `auth.users.id`. Email and display name nonblank.                                                          |
| `sites`                  | `name text not null`; `description text not null default ''`; `location_id text null` FK `locations.id`, unique when non-null; `is_public boolean not null default false`.                                                                                            |
| `planting_areas`         | `site_id text not null` FK `sites.id`; `name text not null`; `description text not null default ''`; `location_id text null` FK `locations.id`, unique when non-null; `is_public boolean not null default false`.                                                     |
| `locations`              | `geometry jsonb not null`. No own publication flag or source/accuracy columns.                                                                                                                                                                                        |
| `species`                | `scientific_name text not null`; `common_name text not null`; `aliases text[] not null default '{}'`; `description text not null default ''`; `image_url text not null default ''`; `is_public boolean not null default false`.                                       |
| `planting_events`        | `site_id text not null` FK `sites.id`; `planting_area_id text null` FK `planting_areas.id`; `planting_date date not null`; `event_type` required; `notes text not null default ''`; `image_url text not null default ''`; `is_public boolean not null default false`. |
| `planting_event_species` | `planting_event_id text not null` FK `planting_events.id`; `species_id text not null` FK `species.id`; `quantity bigint not null`. Unique active `(planting_event_id, species_id)`.                                                                                   |

Do not make site names, area names or species names globally unique without a separate requirement. Multiple areas per site are allowed by the database; an initial UI may expose only one. Relationships are not represented by empty strings.

### 8.4 Integrity and indexing

- Foreign keys retain records; no cascading physical deletes.
- Index event lookup by site/date and by area; count lookup by event and species; area lookup by site; and common FK/audit lookup paths where needed.
- Use a partial unique index on active event/species pairs. A soft-deactivated pair does not block a later valid active pair, but IDs remain globally unique.
- Canonical app email and non-null Auth UUID are unique across both active and inactive users.
- Each active Location belongs to exactly one active Site or Area, never both. Unique indexes on each owner table alone do not prevent cross-table ownership: enforce the combined invariant transactionally.
- Lock an existing location before claiming/replacing it. Detach/deactivate atomically so no active unowned location or active owner pointing at inactive geometry can commit.
- An event's optional area must belong to its selected site. Area `site_id` is immutable in this API. Preserve links to historical inactive areas without accepting new inactive-area links.
- Referenced records must exist. New event/area links require active parents, and new count links require active species. Recheck these states during the same write transaction.

Application timestamps/audits cover updates to nested owned rows too. Updating event lines or owner geometry updates the event/owner audit columns, not just the nested row.

## 9. REST API

### 9.1 Base URL and transport

Hosted base URL:

```text
https://<project-ref>.supabase.co/functions/v1/api
```

Paths in the following tables are relative to that base. The earlier conceptual `/api/...` paths map to this hosted URL; do not promise an additional reverse proxy/custom domain.

JSON requests/responses use UTF-8 and `application/json`. Authenticated requests include `Authorization: Bearer <supabase_access_token>`. Use normal `fetch` for REST GET/PUT/DELETE routing; `functions.invoke` is not required for every endpoint. Support CORS OPTIONS for configured frontend origins, methods and Authorization/Content-Type headers. Return CORS headers on errors too. Never treat CORS as authorisation.

Use `Cache-Control: private, no-store` initially, including for public data, because the same URLs have viewer-dependent responses. No shared public cache of editor data. Serve through HTTPS.

### 9.2 Endpoint matrix

| Resource | List, 200                                              | Detail, 200                                          | Create, 201                                               | Update, 200                                                  | Delete, 204                   |
| -------- | ------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------- |
| Sites    | `GET /sites` → `SiteListResponse[]`                    | `GET /sites/:id` → `SiteResponse`                    | `POST /sites` body `SiteCreateRequest`                    | `PUT /sites/:id` body `SiteUpdateRequest`                    | `DELETE /sites/:id`           |
| Areas    | `GET /planting-areas` → `PlantingAreaListResponse[]`   | `GET /planting-areas/:id` → `PlantingAreaResponse`   | `POST /planting-areas` body `PlantingAreaCreateRequest`   | `PUT /planting-areas/:id` body `PlantingAreaUpdateRequest`   | `DELETE /planting-areas/:id`  |
| Species  | `GET /species` → `SpeciesListResponse[]`               | `GET /species/:id` → `SpeciesResponse`               | `POST /species` body `SpeciesCreateRequest`               | `PUT /species/:id` body `SpeciesUpdateRequest`               | `DELETE /species/:id`         |
| Events   | `GET /planting-events` → `PlantingEventListResponse[]` | `GET /planting-events/:id` → `PlantingEventResponse` | `POST /planting-events` body `PlantingEventCreateRequest` | `PUT /planting-events/:id` body `PlantingEventUpdateRequest` | `DELETE /planting-events/:id` |

Create/update return the corresponding detail `*Response` directly, not a row ID, array or `{ data: ... }`. POST also returns the new resource's URL in the HTTP `Location` header. DELETE has no request body and no response body.

### 9.3 Lists and details

- Lists accept no query parameters. Reject unexpected query parameters with 400 rather than implement server-side filtering. Path parameters still identify individual resources.
- Return every active visible record, or `[]`. Do not truncate to a hidden default limit.
- Stable ordering: sites/areas by name then ID ascending; species by scientific name then ID ascending; events by planting date descending then ID descending. Use deterministic database ordering rather than locale-dependent client/server disagreement.
- Embedded area/event collections use the same list DTOs and ordering, scoped to their parent. Event species lines and species-total groups are consistently ordered by species ID, with any hidden null group last.
- Lists exclude descriptions, full geometry and histories. Site/area `position` is the visible attached Point coordinate, or null.
- Species aliases support client name search. Event `species_ids` contains deduplicated visible species IDs with positive quantities. It does not expose private/deactivated catalogue IDs publicly.
- Site/species dropdowns use ordinary lists. Do not add duplicate lookup endpoints or historical-reference endpoints.

**Supabase-specific requirement:** its Data API limits returned rows. A plain `.select()` cannot be assumed to return every record. Use internal batching or a focused read RPC returning typed data that explicitly guarantees completeness, then assemble response objects in TypeScript. This is an internal retrieval concern, not permission to add public pagination. Verify more than 1,000 matching records. Supabase's row-limit reference documents the default cap; verify the actual project's configured limit at deployment. [Row-limit reference](https://supabase.com/docs/reference/javascript/v1/select).

## 10. Complete TypeScript API contracts

This block is self-contained and preserves the named domain contracts, including the site and species create aliases. Shared primitives are included so the backend developer does not need the source TypeScript files. `ErrorResponse` is infrastructure, not a fifth contract per resource. Its `internal_error` case is the small addition needed for explicit HTTP 500 handling.

The `is_active` fields on nested event references indicate retained current relationships to deactivated records. They are not historical snapshots or separate API resources. No `Historical*`, `*Ref`, totals, metadata or Location interfaces are introduced.

<!-- CONTRACTS_START -->

```ts
/** Shared HTTP contracts and primitives. Database rows are not API responses. */
export type Id = string;
/** UTC ISO 8601 instant. */
export type Timestamp = string;
/** Calendar date, YYYY-MM-DD. */
export type CalendarDate = string;
/** GeoJSON longitude first, latitude second. */
export type Position = [longitude: number, latitude: number];
export type LinearRing = [
  Position,
  Position,
  Position,
  Position,
  ...Position[],
];
export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "Polygon"; coordinates: [LinearRing, ...LinearRing[]] };
export type PlantingEventType = "establishment" | "infill" | "replacement";

// Sites

export interface SiteListResponse {
  id: Id;
  name: string;
  is_public: boolean;
  /** Point or representative polygon point, without the full geometry. */
  position: Position | null;
}

export interface SiteResponse extends SiteListResponse {
  description: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  location: { id: Id; geometry: Geometry } | null;
  totals: { planting_event_count: number; total_plants: number };
  species_totals: {
    /** Null when the catalogue reference is not visible to the caller. */
    species: {
      id: Id;
      scientific_name: string;
      common_name: string;
      image_url: string;
    } | null;
    quantity: number;
  }[];
  /** Complete related arrays, restricted to records visible to the caller. */
  planting_areas: PlantingAreaListResponse[];
  planting_events: PlantingEventListResponse[];
}

export interface SiteUpdateRequest {
  name: string;
  description: string;
  /** Server creates the location ID or retains the existing one. Null removes it. */
  location: { geometry: Geometry } | null;
  is_public: boolean;
}

/** POST generates the site and any new location IDs on the server. */
export type SiteCreateRequest = SiteUpdateRequest;

// Planting areas

export interface PlantingAreaListResponse {
  id: Id;
  name: string;
  site: { id: Id; name: string; is_public: boolean };
  position: Position | null;
  is_public: boolean;
}

export interface PlantingAreaResponse extends PlantingAreaListResponse {
  description: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  location: { id: Id; geometry: Geometry } | null;
  totals: { planting_event_count: number; total_plants: number };
  species_totals: {
    /** Null when the catalogue reference is not visible to the caller. */
    species: {
      id: Id;
      scientific_name: string;
      common_name: string;
      image_url: string;
    } | null;
    quantity: number;
  }[];
  planting_events: PlantingEventListResponse[];
}

export interface PlantingAreaUpdateRequest {
  /** Required on create and immutable on update. */
  site_id: Id;
  name: string;
  description: string;
  location: { id: Id; geometry: Geometry } | null;
  is_public: boolean;
}

export interface PlantingAreaCreateRequest extends PlantingAreaUpdateRequest {
  id: Id;
}

// Species

export interface SpeciesListResponse {
  id: Id;
  scientific_name: string;
  common_name: string;
  image_url: string;
  /** Included so the client can search aliases without fetching every detail. */
  aliases: string[];
  is_public: boolean;
}

export interface SpeciesResponse extends SpeciesListResponse {
  description: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** Counts this species only, not all plants in matching events. */
  totals: { planting_event_count: number; total_plants: number };
  /** All visible active events with a positive quantity of this species. */
  planting_events: PlantingEventListResponse[];
}

export interface SpeciesUpdateRequest {
  scientific_name: string;
  common_name: string;
  aliases: string[];
  description: string;
  image_url: string;
  is_public: boolean;
}

/** POST generates the species ID on the server. */
export type SpeciesCreateRequest = SpeciesUpdateRequest;

// Planting events

export interface PlantingEventListResponse {
  id: Id;
  site: { id: Id; name: string; is_public: boolean };
  /** Null if unassigned or not visible to the caller. */
  planting_area: { id: Id; name: string } | null;
  planting_date: CalendarDate;
  event_type: PlantingEventType;
  /** Visible positive-quantity species, for client-side filtering. */
  species_ids: Id[];
  total_plants: number;
  is_public: boolean;
}

export interface PlantingEventResponse extends PlantingEventListResponse {
  /** Retained inactive references remain available to editors. */
  planting_area: { id: Id; name: string; is_active: boolean } | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  notes: string;
  image_url: string;
  /** Active visible area's location, falling back to the site's location. */
  location: { id: Id; geometry: Geometry } | null;
  /** Editors get every actual line. Public hidden quantities form one null group. */
  species: (
    | {
      /** Event-species row ID, retained when editing. */
      id: Id;
      species: {
        id: Id;
        scientific_name: string;
        common_name: string;
        image_url: string;
        is_active: boolean;
      };
      quantity: number;
    }
    | { id: null; species: null; quantity: number }
  )[];
}

export interface PlantingEventUpdateRequest {
  site_id: Id;
  planting_area_id: Id | null;
  planting_date: CalendarDate;
  event_type: PlantingEventType;
  notes: string;
  image_url: string;
  is_public: boolean;
  /** Complete desired line set; omitted existing rows are soft-deactivated. */
  species: {
    /** Caller-generated for new rows, retained for existing rows. */
    id: Id;
    species_id: Id;
    quantity: number;
  }[];
}

export interface PlantingEventCreateRequest extends PlantingEventUpdateRequest {
  id: Id;
}

export interface ErrorResponse {
  error: {
    code:
      | "validation_error"
      | "unauthenticated"
      | "forbidden"
      | "not_found"
      | "conflict"
      | "internal_error";
    message: string;
    /** Optional field-path errors, e.g. { "species.0.quantity": "Must be >= 0" }. */
    fields?: Record<string, string>;
  };
}
```

<!-- CONTRACTS_END -->

## 11. Write transactions and lifecycle

### 11.1 Create and full-form update

Site and species POST generate their IDs on the server; area/event target POST bodies include the supplied resource ID. PUT uses the URL ID and the complete editable form, not the read DTO. Every property in the corresponding request interface is required, including nullable relationship properties and arrays. Missing fields are validation errors, not instructions to reset them. Reject audit fields, body-level resource IDs on PUT and other unknown fields.

ID collisions, including collisions with inactive rows, return 409. POST is never an upsert. Ordinary PUT cannot edit an inactive resource and returns 404. A parent hidden by an inactive Site is also outside ordinary update access. Restoration is not included.

Each write checks that the authenticated app actor remains active and is not client-selected. Lock relevant parent/referenced rows so concurrent saves/deactivation cannot leave invalid state. Use database constraints as the final integrity boundary, including under parallel requests.

### 11.2 Site/area location save

For sites, the complete `location` property is either null or `{ geometry }`; it never contains a caller-selected location ID.

- Creating a site generates its site ID and, when geometry is supplied, a new location ID in the same transaction.
- No previous location + null: leave the site unlocated.
- No previous location + geometry: generate and attach a new location.
- Existing location + geometry: update geometry in place, retaining its ID and creation audit fields.
- Existing location + null: clear the site's link and deactivate the location atomically. A later geometry save generates a fresh ID.
- Site responses still include the server-assigned site/location IDs. Site DELETE deactivates its owned location atomically and retains the historical link.

Area input retains the target `{ id, geometry }` or null shape, with the following existing rules:

- No previous location + null: leave unlocated.
- New supplied ID + valid Point: insert the location and attach it in the same transaction.
- Existing owned ID: update geometry in place; retain ID and creation audit fields.
- Null replacing an existing location: clear owner's link and deactivate the old location atomically.
- Different new ID replacing an existing location: insert/attach new location and deactivate old one atomically.
- ID belonging to another owner: 409. An inactive detached ID is not reusable through this API; use a new supplied ID.

There is no independent Location publication. Its visibility follows the owner and the owner's effective parent visibility.

### 11.3 Event species/count save

Treat `species` as the entire desired active line set, saved with the event in one transaction:

1. Validate the selected site and optional area. Lock/recheck parents and relevant existing count rows.
2. Reject duplicate line IDs and duplicate species IDs in the submitted active set.
3. Existing line ID for this event: preserve that row and its creation fields; update its editable fields.
4. New line ID: insert a new count row for this event, with server-set audit fields.
5. Omitted currently active rows: soft-deactivate them.
6. Previously inactive line ID explicitly resubmitted for this same event: reactivate it only after all current checks pass. This is limited nested-row reuse, not general parent restoration.
7. A supplied line ID belonging to another event: 409, never move it.
8. Update the event audit fields and return the full event detail after all checks succeed.

Use an operation order that supports changing the desired set without transiently violating the active `(event, species)` uniqueness rule. Any failed line rolls back the event and every line change. An empty array is permitted and explicitly removes all active lines. A missing array is an error.

An unchanged existing reference to an inactive species may be retained while editing notes or quantities. Adding a new line to inactive species, changing a line to inactive species, or reactivating a line pointing to inactive species is rejected. This preserves history without encouraging new inactive links.

An unchanged inactive-area link may likewise remain on an event PUT. Changing the site's value requires a consistent selected area; a retained inactive area cannot be used as a new assignment to another site. Editor responses retain the historical area's ID/name/active state so unrelated edits do not discard it.

### 11.4 Soft deactivation

- Existing accessible resource: set `deactivated_at` and update audit fields; return 204.
- Already inactive existing resource: repeated DELETE returns 204 without rewriting the original deactivation timestamp.
- Unknown ID: 404.
- Site/Area DELETE also deactivates its attached Location in the same transaction, retaining the owner FK for history.
- Do not deactivate all a Site's child Areas/Events. The inactive Site makes them inaccessible through ordinary lists, details and updates without rewriting their rows.
- Deactivating an Area does not remove its events or reduce Site planting totals. Events retain their old area link; geometry falls back to the Site.
- Deactivating Species hides it from ordinary catalogue reads but never deletes its recorded quantities.
- Deactivating an Event removes that event and its quantities from ordinary totals/history. Count rows may remain retained; their active parent requirement excludes them from totals.

Repeated DELETE of a child under an inactive Site can remain a 404 because the parent makes it inaccessible; idempotent 204 does not override access scope.

## 12. Read models, publication and totals

### 12.1 Viewer scopes

| Entity            | Anonymous scope                                        | Approved editor scope                                |
| ----------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Site              | Active and `is_public = true`.                         | All active Sites.                                    |
| Area              | Active and public, with an active public Site.         | Active Area with active Site.                        |
| Event             | Active and public, with an active public Site.         | Active Event with active Site.                       |
| Species catalogue | Active and public.                                     | All active Species.                                  |
| Location          | Only through its effectively visible owning Site/Area. | Through active accessible owner.                     |
| App User          | Never returned in domain data.                         | No user-list/read API; actor is resolved internally. |

Stored `is_public` is publication intent. Area/Event effective public visibility additionally requires its Site's visibility. The optional Area is not an Event visibility gate: a public Event on a public Site may refer to a private/inactive Area, but anonymous output must hide that Area's identity and geometry.

Inaccessible detail IDs return 404 with no private name or existence explanation. Invalid supplied authentication is 401; valid but unauthorised authentication is 403. Do not convert an inaccessible entity into an empty object or editor response.

### 12.2 Detail composition

| Response                | Required joins / content                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `SiteResponse`          | Site and owned location; complete visible active Areas and Events; Site actual totals and per-species quantities.                           |
| `PlantingAreaResponse`  | Area, parent Site and owned location; complete visible matching Events; Area actual totals and species quantities.                          |
| `SpeciesResponse`       | Catalogue record; complete visible active Events with a positive matching quantity; totals for this Species only.                           |
| `PlantingEventResponse` | Event, parent Site, optional visible/historical Area, effective Location, complete active count rows and permitted compact Species details. |

The event's effective Location is the active accessible Area's active Location when available, otherwise the active Site's active Location, otherwise null. If the Area is private for an anonymous viewer, use the Site location rather than reveal Area geometry. Location is read-only on the Event API.

Related collections contain list DTOs, not nested details, to avoid recursion and oversized repeated histories. Inline references are current record values, not frozen historical names.

### 12.3 Actual totals

- Start from active count rows under active, viewer-visible Events with active accessible Sites.
- `total_plants` sums quantities, regardless of event type. It is actual recorded planting, not estimated survival or current standing trees. Replacement/infill counts do not change older events' quantities.
- Site/Area `planting_event_count` counts visible active Events, including empty/zero-total Events. Species event count/history includes only Events with a positive quantity of that Species.
- Species detail `totals.total_plants` counts only the selected Species. An Event listed inside that detail still has its whole-event `total_plants`.
- Area totals only include Events explicitly assigned to that Area. Site-only history remains site-only; do not fabricate an Area allocation.
- Inactive Species quantities still contribute to actual planting totals. An inactive optional Area does not remove an otherwise visible Event from Site totals.
- Keep zero-quantity lines in Event detail for editing. Exclude zero-only groups from per-species summary arrays and from `species_ids`.
- A private Event contributes nothing to anonymous totals, even if its Site/Species is public. An active public Event's private Species quantities do contribute, without exposing the Species identity.
- Calculate numeric sums in Postgres with sufficient precision; check them against `Number.MAX_SAFE_INTEGER` before conversion to JSON numbers. Never round an unsafe quantity to fit JavaScript.

Do not join all Areas, Events and count rows into an ungrouped result and then sum. Use independent grouped aggregates/CTEs/subqueries so multiple relationships do not multiply totals. Compute detail histories and totals from a consistent read snapshot, using a focused SQL query where necessary, and assemble the public JSON representation in TypeScript.

### 12.4 Redacting hidden and inactive references

Editors receive all actual active Event count lines with their real line IDs, even when a linked Species is inactive. Include the compact Species display values and `is_active: false`. Retained inactive Area references use the same inline active flag in Event detail. Ordinary Event list items return null for an inactive Area; the detail response is the explicit editor exception that preserves the old link for editing. This does not make inactive Areas/Species available through ordinary direct GETs.

For anonymous output:

- Event count rows whose Species catalogue entry is private or inactive are merged into one `{ id: null, species: null, quantity: combinedQuantity }` entry. Do not reveal the original row IDs, Species IDs, names, aliases, images or number of hidden catalogue entries.
- Site/Area species totals likewise combine positive hidden quantities into one `{ species: null, quantity: combinedQuantity }` group.
- Visible active published Species keep their permitted compact identity. Public `species_ids` contains only visible active published Species with positive counts.
- A hidden/inactive Area becomes null in an anonymous Event. Its notes/geometry are not substituted into other fields.
- App-user IDs, emails, Auth UUIDs and raw audit actor columns are never part of domain DTOs.

When all hidden line quantities are zero, an Event may still expose one zero-valued null group because its complete active line set contains hidden zero-count data. Do not reveal additional identity information; Site/Area summaries still omit zero-only groups.

Apply these rules during scoped query/serialization, not by sending private data and asking the client to hide it.

### 12.5 Image URLs

Store one stable HTTPS image URL or `""`. The backend does not fetch, proxy, upload or inspect images. Public/private record visibility controls whether the API returns the URL, not whether an external host serves the bytes. Do not treat an unlisted public image URL as private storage or promise revocation of a URL already shared.

Image-host selection and supplying suitable URLs are launch/content inputs. If protected uploads, dated photos or galleries are required, agree a separate change rather than silently adding them to this contract.

## 13. Validation and errors

### 13.1 Input validation

Validate path IDs, JSON shape and required fields at the API boundary; enforce database invariants again at persistence boundaries. TypeScript interfaces are not runtime validation. Use a small maintained validation library or explicit validators, not a custom schema framework.

- Names, required species names and approved user email/display name cannot be blank. Optional descriptions/notes/image URL accept `""`, not null.
- Accept only documented properties/types. Reject numeric strings, implicit boolean coercion, null text, unknown enum values and unexpected query parameters.
- Validate dates as real calendar dates with exact formatting, leap-year rules and year 1 through 9999. Do not parse them through timezone-bearing JavaScript timestamps and shift the day.
- Quantity is a finite non-negative safe integer. Reject fractions, negative values, unsafe integers and null. Validate before casts that could round/truncate values.
- Coordinates are exactly `[longitude, latitude]`, numeric and finite. Longitude is between -180 and 180; latitude between -90 and 90. Do not swap coordinates automatically. Permit null location where no reliable pin is known.
- Reject Polygon input in this release even though the shared union reserves its future shape. Later enablement must validate closed rings, holes and coordinate ranges, not merely accept arbitrary JSON.
- `image_url` is empty or an absolute HTTPS URL. Do not make the API request that URL as part of validation.
- Aliases are an array of strings, without nulls. Do not silently invent aliases or merge species from similar names.

Use parameterized SQL/RPC inputs, never interpolate request values into SQL. If operational request-size/time limits are introduced, document the chosen values; do not implement arbitrary per-list truncation as a safety measure.

### 13.2 HTTP errors

| HTTP | `error.code`       | Meaning                                                                                                |
| ---- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| 400  | `validation_error` | Malformed JSON, invalid field/query/path ID, missing required field or unsupported relationship input. |
| 401  | `unauthenticated`  | Missing token for writes; supplied token invalid, expired or malformed.                                |
| 403  | `forbidden`        | Valid identity is not an approved active WRT editor or has the wrong provider.                         |
| 404  | `not_found`        | Missing, inactive or inaccessible resource; unknown route.                                             |
| 409  | `conflict`         | ID collision, ownership/lifecycle conflict, uniqueness conflict or unsafe aggregate quantity.          |
| 500  | `internal_error`   | Unexpected backend/database or dependency failure; no private implementation details.                  |

Unsupported methods return 405 with `Allow` and the error shape (`validation_error` is sufficient; no new domain DTO). A normal CORS OPTIONS response is transport handling, not a domain action.

Example validation response:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Check the supplied fields.",
    "fields": { "species.0.quantity": "Must be a non-negative safe integer." }
  }
}
```

Translate known database failures into stable API errors. Never expose SQL statements, constraint internals, stack traces, credentials, emails of other users or token contents. Log a correlation/request identifier and safe error context server-side; returning that identifier in a response header is sufficient.

## 14. Historical import

The one-off WRT import is in scope, but a general import HTTP endpoint is not. Deliver an operator-run script using the same validation and transactional business rules, with privileged credentials outside the frontend.

1. Obtain the actual source files and agree site/species matching with the WRT data steward. Do not infer the import schema from summaries.
2. Dry-run: report candidate records, matches, duplicates and invalid/unresolved rows without writing.
3. Maintain a source-key-to-domain-ID mapping in a durable import artifact so rerunning the same source does not generate new IDs or duplicate data. This does not require an eighth application table.
4. Check all dependencies and quantities; split into small recoverable batches. Insert an Event and its counts atomically.
5. Keep source planting dates distinct from current database creation/import timestamps. Attribute insertion to the importing app user.
6. Preserve site-only history. Unknown Area means null; never invent an Area or divide a Site quantity between Areas without evidence.
7. Missing exact date, unknown event type, unresolved Species or unknown quantity goes into a review report. Do not convert a year-only date to 1 January, an unknown type to establishment or unknown count to zero.
8. Default imported `is_public` to false unless explicit publication approval is present in the reviewed import mapping. Publication is not implied by a spreadsheet being supplied.
9. Reconcile Site/Species/Event counts and quantity sums against reviewed source totals. Produce an imported/rejected/skipped summary and preserve rejected source rows for correction.
10. Rerun verification must make no unintended changes. Explicit corrections are a reviewed update mode, not blind upsert of every existing ID.

Do not run a large spreadsheet transformation inside a latency-limited Edge request. Source availability and review of imprecise historical dates are dependencies for completing the import, not reasons to fabricate values or expand the schema unilaterally.

## 15. Development, deployment and operation

### 15.1 Suggested repository layout

```text
supabase/
  config.toml
  migrations/                 # tables, indexes, constraints, permissions, RPCs
  functions/api/
    index.ts                 # entrypoint, router, CORS, error boundary
    auth.ts                  # validated Google identity -> active app actor
    validation.ts
    routes/                  # sites, planting areas, species, planting events
    services/                # scoped queries / RPC calls, shared business rules
shared/
  api-contracts.ts            # section 10; frontend/backend share the contract
scripts/
  provision-editor.ts
  import-history.ts
tests/
  ...                        # meaningful business/security integration tests
```

This is guidance, not a requirement to create every directory or abstraction before it is useful. Keep database migrations/functions in version control, not only in dashboard SQL history. Pin dependencies and commit the relevant lockfile.

### 15.2 Configuration and secrets

| Value                                          | Where                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Supabase project URL and publishable key       | Frontend/server environment; these are not privileged credentials.               |
| Supabase server secret/service-role credential | Edge/operator secret storage only. Never a `VITE_*` variable or frontend source. |
| Google OAuth client secret                     | Supabase Auth provider configuration only.                                       |
| Google client ID, allowed OAuth return URLs    | Supabase/Google configuration as appropriate.                                    |
| Allowed frontend origins                       | Edge environment/configuration, exact production and local development origins.  |

No Resend account, SMTP configuration or paid authentication product is required for the Google-only application. Do not enable unrelated email flows that would reintroduce a mail-delivery dependency.

### 15.3 Environment and deployment sequence

1. Establish Supabase/Google project ownership, region and intended frontend URL. Separate local/test data from production. No paid environment is implied.
2. Apply versioned schema, function and privilege migrations to an empty test database.
3. Configure Google OAuth and redirect allowlists; configure the `api` function for mixed public/authenticated routes and set server secrets.
4. Provision at least one approved app user using the bootstrap procedure. Do not enable open app-user creation to simplify this step.
5. Deploy `api`; verify CORS, public requests and authenticated routes against the actual hosted runtime, not just unit mocks.
6. Run integration/acceptance checks, including direct Data API/RPC denial and publication redaction.
7. Export/backup existing production data before a destructive migration or import; rehearse on test data first. Use additive migrations where possible.
8. Run the reviewed historical import, reconcile results and have the data steward review publication.
9. Hand over project access, deployment instructions, recovery/export procedure and known limitations to the agreed custodian.

The Supabase CLI can serve functions locally. Its full local stack may use Docker; this is optional development tooling, not a production Docker-hosting requirement. A hosted non-production project is an alternative where available within plan limits.

### 15.4 Free-tier operating envelope

At the documentation check on **19 October 2026**, Supabase's Free plan lists:

| Resource       | Included limit / behavior                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Auth           | 50,000 monthly active users; social OAuth supported.                                                  |
| Database       | 500 MB.                                                                                               |
| Edge Functions | 500,000 invocations per month. A router with many endpoints still consumes an invocation per request. |
| Egress         | 5 GB, with a separate cached-egress allowance.                                                        |
| Free projects  | Up to two active projects; inactive projects may pause after one week.                                |

These are platform allowances, not a measured forecast of WRT usage or an uptime commitment. Recheck pricing before deployment, monitor actual usage and discuss any upgrade with James first. Edge Functions also have runtime/CPU/memory limits; normal CRUD belongs here, heavy imports do not. [Pricing](https://supabase.com/pricing), [runtime limits](https://supabase.com/docs/guides/functions/limits).

Do not assume a downloadable automatic database backup is provided for Free projects. Deliver a manual export/restore procedure and identify the custodian; verify restoration with non-production data. An export of app records alone does not recreate Google credentials or a working Supabase Auth configuration. [Backup guidance](https://supabase.com/docs/guides/platform/backups).

### 15.5 Logs and basic operation

Use Supabase's available logs and usage dashboard first. Record safe request IDs, method/route, status, duration and classified failures. Do not log bearer/refresh tokens, OAuth codes, Google secrets or full private request/response bodies. No separate monitoring subscription, cron system or analytics pipeline is required.

Document how to add/deactivate an editor, rotate a server secret, run an export, diagnose a failed save/import and restore service after a free-project pause. Deactivation must not delete the actor's audit history.

## 16. Acceptance and developer deliverables

### 16.1 Acceptance matrix

These are implementation requirements to be demonstrated with tests or repeatable integration checks. They are not claims that tests have already run.

| Check                        | Expected result                                                                                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google sign-in               | Approved Google account obtains a Supabase session and can use editor reads/writes; no WRT-issued token.                                                                                                                                                                    |
| Unapproved/inactive identity | Valid unapproved Google account and deactivated app user receive 403 for authenticated domain access. Forged/expired/wrong-project tokens receive 401.                                                                                                                      |
| Identity binding             | First verified approved account binds once. An unverified email, forged metadata or different UUID cannot claim/rebind the editor. Concurrent binds preserve uniqueness.                                                                                                    |
| Anonymous writes             | POST/PUT/DELETE without a token fail with 401 and leave data unchanged. All four resources are covered.                                                                                                                                                                     |
| Platform bypass              | Browser publishable key alone and an approved user's JWT cannot directly read/mutate app tables or execute privileged RPCs.                                                                                                                                                 |
| Public publication           | Private/inactive Site hides children. Private Event does not contribute to public history/totals. Private Area does not hide an otherwise public Event, but its identity/geometry are removed.                                                                              |
| Hidden Species               | Public quantities still reconcile; hidden/inactive Species identities and original line IDs are absent and consolidated into the null group. Editors retain actual line IDs.                                                                                                |
| Lists                        | All endpoints return arrays, including `[]`; no envelopes, filters, pagination or silent 1,000-row cutoff. Unexpected query parameters return 400.                                                                                                                          |
| Details/contracts            | Required joined objects and complete arrays match section 10. Lists omit large detail fields. No separate Historical/Ref DTOs or auth contracts appear.                                                                                                                     |
| Event atomicity              | One invalid line fails the whole save with no event/line partial update. Omitted lines deactivate; unchanged row IDs persist; duplicate Species/foreign line IDs fail.                                                                                                      |
| Location atomicity           | Geometry updates retain ID; detach/replacement/deletion updates ownership/lifecycle atomically. Two owners cannot claim one location, including cross-table/concurrent claims.                                                                                              |
| Historical inactive links    | Editing notes preserves unchanged inactive Species/Area links. New inactive links fail. Species deactivation does not reduce recorded actual quantities.                                                                                                                    |
| Soft deletion                | Existing DELETE returns empty 204; repeat preserves original timestamp; unknown/inaccessible ID is 404. Site child rows remain stored; no physical cascade.                                                                                                                 |
| Audit                        | Browser audit spoofing is rejected. Parent audit changes when only nested geometry/counts change. App IDs, not Auth UUIDs, appear in audit FKs.                                                                                                                             |
| Totals                       | Multi-Area, multi-Event, multi-Species fixture produces no join fan-out. Zero lines, empty Events, private Events and inactive Species match section 12.                                                                                                                    |
| Concurrency                  | Simultaneous full-form saves cannot interleave desired line sets or produce an invalid parent/child state; last committed valid save wins.                                                                                                                                  |
| Validation                   | Invalid calendar dates, unsafe/fractional counts, malformed IDs, invalid coordinate shapes/out-of-range values, Polygon input and null ordinary text fail as specified. Longitude-first order is preserved; ambiguous in-range coordinates are not automatically corrected. |
| Errors/CORS                  | Browser preflight succeeds for allowed origins. Domain errors retain CORS/error shape; 500 does not leak SQL/secrets. 204 contains no body.                                                                                                                                 |
| Sign-out                     | SDK session and private caches clear; subsequent requests omit the token and receive public scope. No custom logout route exists.                                                                                                                                           |
| Import                       | Dry-run writes nothing; first run reconciles to reviewed source; rerun creates no duplicates; missing date/type/quantity is reported, not invented.                                                                                                                         |
| Deploy/recovery              | Migrations run on an empty database; hosted smoke test passes; documented export restoration is rehearsed on non-production data.                                                                                                                                           |

Include fixtures spanning public/private/inactive parents and historical references, not only happy-path CRUD. Test with actual database constraints and representative concurrent writes where invariants depend on transactions.

### 16.2 Deliverables

- Versioned migrations for all seven domain tables, the Auth mapping column, constraints/indexes, permissions and transactional/read functions.
- One deployable TypeScript Edge Function `api`, implementing the specified routes, validation, authentication, scope and errors.
- Shared TypeScript contracts aligned with section 10, without custom auth interfaces.
- Google OAuth configuration instructions and app-user provisioning/deactivation script or documented equivalent.
- Historical import script, dry-run/reconciliation output format and durable source-ID mapping approach.
- Meaningful automated/integration checks covering the acceptance matrix, with commands and results documented.
- Environment/deployment runbook, operator handover, free-tier limits/known constraints and export/restore instructions.
- No production secrets committed. No claimed feature completion without passing implementation checks.

## 17. Assumptions and launch inputs

### 17.1 Explicit implementation assumptions

These are reversible technical defaults selected to make the handoff buildable, not additional features already signed off by WRT:

1. Every active app user is a full WRT editor; there is no viewer/editor/admin hierarchy.
2. Preapproved email bootstrap plus a nullable unique Auth UUID mapping is sufficient. Operator-managed rebinding is rare and has no UI.
3. Domain data is accessed only through the Edge API; server credentials bypass RLS and therefore require explicit scoped SQL/serializers. Browser grants are denied.
4. JSONB geometry and native text-array aliases are adequate; no spatial extension is needed for Phase 1 pins.
5. Full-form saves use serialized last-write-wins semantics. No edit-conflict warning/version contract is promised.
6. Domain IDs remain 16 characters. Sites, new site locations and species use server-generated IDs; area/event target contracts still accept supplied IDs. Identity UUIDs do not change that scheme.
7. Single external image URLs and exact dates are the current agreed simplification; richer photos and partial date precision require a change if real import data demands them.
8. This is a backend handoff for the current records/public-map slice, not formal acceptance of the entire longer-term roadmap or a fixed delivery estimate.

### 17.2 Inputs needed before live deployment/import

| Input / decision                                             | Why it is needed                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Supabase owner, region and access custodian                  | Project creation, data location and ongoing administration.                       |
| Google Cloud owner and OAuth credentials                     | Enable staff Google sign-in and maintain consent/redirect configuration.          |
| Production frontend URL and local/test origins               | Configure OAuth return URLs and CORS.                                             |
| Approved staff emails, app IDs and display names             | Seed the editor allowlist without open app signup.                                |
| Actual WRT historical files and a named reviewer             | Determine source mapping, resolve missing dates/types/counts and validate totals. |
| Suitable image URLs / image host                             | The current backend stores references, not uploaded files.                        |
| Export/recovery custodian and acceptable operating procedure | Free-tier pausing and backup behavior need an owner.                              |

These do not block schema/API development with fixtures. Do not fabricate values or enable permissive defaults to make deployment appear complete. Changes that alter contracts, introduce paid services or restore deferred features require James's direction.

## 18. Sources and superseded material

### 18.1 Project provenance

- James's current conversation: plain array lists; client filtering; four named interfaces per resource; `extends`, never omission-derived contracts; no application logout endpoint; simplified nested types; Google-only OAuth; Supabase Edge API with transactional database functions; one developer handoff document.
- [Current persisted-row TypeScript](../database-tables.ts): seven tables, shared audit/deactivation columns, relationship fields, exact date and one image URL.
- [Current API TypeScript](../api-contracts.ts): 16 domain interfaces and inline nested objects, copied into section 10. Its old custom authentication interfaces are intentionally excluded.
- [Earlier API behavior notes](../api-contracts.md): retained write lifecycle, complete arrays, visibility, historical-count handling and validation rules. Supabase auth/storage decisions here supersede the older auth section.
- [Earlier database constraint notes](../database-tables.md): retained relationship/lifecycle rules, but their image arrays, `asId` helper and unselected database language are superseded. Its caller-supplied ID behavior is superseded for sites, new site locations and species by the current server-generated ID contracts.
- [Current phased roadmap](../../analysis/phased-roadmap-2026-10-15.md), James's 18 October revision: wider context and one-off WRT import. Phase 1 magic-link wording, dated-photo aspirations and partial-date wording are narrowed by the later explicit design decisions; future phases remain deferred.

### 18.2 Platform references

Platform facts were checked against the linked official Supabase/PostgREST documentation on 19 October 2026. Product defaults and limits can change; confirm them at implementation/deployment. The architecture, access model and business rules above are this project's specification, not claims that Supabase automatically enforces them.

No external credentials, actual staff email allowlist or private historical records are embedded in this document.
