# Minimal REST API proposal

## Design

- Four domain resources: sites, planting areas, species and planting events. No standalone Location, event-species, planning, image or user-administration CRUD.
- List endpoints return small row/card/map payloads. Detail endpoints return joined display/edit data: names instead of bare foreign keys, geometry, species/count lines, rollups and complete related arrays.
- Direct object responses for detail/create/update; plain arrays for collections, for example `SpeciesListResponse[]`. `*ListResponse` names the compact item interface, not an array envelope. No pagination, query filters, redundant `data` wrapper or general-purpose `include` machinery. Search and filtering happen in the client.
- Preserve snake_case. Ordinary text is non-null; empty optional descriptions/notes/image URLs are `""`. Missing relationships are null; omitted optional error metadata is not a null string.

## Read endpoints

| Endpoint                       | Response, HTTP 200            |
| ------------------------------ | ----------------------------- |
| `GET /api/sites`               | `SiteListResponse[]`          |
| `GET /api/sites/:id`           | `SiteResponse`                |
| `GET /api/planting-areas`      | `PlantingAreaListResponse[]`  |
| `GET /api/planting-areas/:id`  | `PlantingAreaResponse`        |
| `GET /api/species`             | `SpeciesListResponse[]`       |
| `GET /api/species/:id`         | `SpeciesResponse`             |
| `GET /api/planting-events`     | `PlantingEventListResponse[]` |
| `GET /api/planting-events/:id` | `PlantingEventResponse`       |

List endpoints accept no query parameters; reject unexpected parameters with 400 `ErrorResponse`. They return all active records visible to the caller, or `[]` when none are visible. Search, relationship filtering, year filtering and display sorting happen in the client. Server-side access control still applies before serialization, joins and rollups; it is not a client-side filter. Site/area arrays have stable name-then-ID order, species scientific-name-then-ID order, and events planting-date-descending-then-ID-descending order.

Nested collections in detail responses are complete arrays scoped to that parent: all its visible areas/events, not initial pages. An event's species array is its complete owned line set for editing. Lists retain compact row/card/map shapes; related arrays do not recursively embed full detail resources. Site/species dropdowns use the same ordinary list endpoints.

`position` on site/area lists is the attached point or a derived representative point for a polygon. Lists do not carry full polygon coordinates or large descriptions. Map clients obtain every visible site pin in one site-list request, or area pin in one area-list request. Events do not carry a separate map position; clients resolve their area/site against those lists. Area/site detail provides the full geometry when needed.

Species lists include aliases for client-side name search. Event lists include deduplicated `species_ids` with positive quantities for client-side species filtering; include only catalogue references visible to the caller. Site species filtering can combine these event rows by their Site ID. Hidden species quantities still contribute to totals, but their IDs never appear in public lists.

Primary resource contracts use `*CreateRequest`, `*UpdateRequest`, `*ListResponse` and `*Response`. Create requests extend update requests to add the caller-supplied ID. Shared contracts use explicit interfaces and `extends`, never mapped omission helpers. Nested update objects include their IDs for both new and retained rows.

## Write endpoints

All writes require a valid bearer token for an active authorised WRT user. POST supplies caller-generated IDs; no endpoint generates IDs. The server validates every ID is exactly 16 characters at the request boundary. PUT replaces the full editable form, not the read DTO or server-managed fields.

| Endpoint                          | Request                      | Success response            |
| --------------------------------- | ---------------------------- | --------------------------- |
| `POST /api/sites`                 | `SiteCreateRequest`          | 201 `SiteResponse`          |
| `PUT /api/sites/:id`              | `SiteUpdateRequest`          | 200 `SiteResponse`          |
| `DELETE /api/sites/:id`           | No body                      | 204, no body                |
| `POST /api/planting-areas`        | `PlantingAreaCreateRequest`  | 201 `PlantingAreaResponse`  |
| `PUT /api/planting-areas/:id`     | `PlantingAreaUpdateRequest`  | 200 `PlantingAreaResponse`  |
| `DELETE /api/planting-areas/:id`  | No body                      | 204, no body                |
| `POST /api/species`               | `SpeciesCreateRequest`       | 201 `SpeciesResponse`       |
| `PUT /api/species/:id`            | `SpeciesUpdateRequest`       | 200 `SpeciesResponse`       |
| `DELETE /api/species/:id`         | No body                      | 204, no body                |
| `POST /api/planting-events`       | `PlantingEventCreateRequest` | 201 `PlantingEventResponse` |
| `PUT /api/planting-events/:id`    | `PlantingEventUpdateRequest` | 200 `PlantingEventResponse` |
| `DELETE /api/planting-events/:id` | No body                      | 204, no body                |

- POST returns `Location` header for the new resource. ID collisions are 409, never silently repurposed records.
- Parent, Location and event-species writes are atomic. Reuse a Location ID for geometry changes; replacement/detachment soft-deactivates the old Location. Reject using a Location ID owned elsewhere.
- An inactive detached Location ID is not reusable in this first API; return 409 and require a new supplied ID. On site/area DELETE, deactivate its own attached Location in the same transaction and retain the owner link. Do not cascade deactivation to child areas/events. Repeated DELETE leaves both owner and Location inactive without rewriting their original deactivation timestamps.
- Event species input is the complete desired active set. Preserve each line's ID on edit; new lines need externally supplied IDs. Omitted lines are soft-deactivated. Reject duplicate species/line IDs and any line ID owned by another event. An empty set explicitly removes all lines; missing the required `species` property is a validation error, not an empty set. If an inactive line ID is explicitly resubmitted for the same event, reactivate it after validation; never create a second row with that ID. An unchanged historical link to a deactivated species may be retained, but adding or changing a link to inactive species is rejected.
- Editing lines/geometry also updates their parent resource's audit fields, so child changes are not invisible as parent edits. Authenticated actor/audit timestamps are server-managed; public/user IDs from response data are not trusted as write authority.
- Event area must belong to its selected site. Area site ownership is immutable in this minimal API. Event site corrections remain possible if the selected area is also consistent.
- Creates and event site/area changes require active parent records. An event may retain its unchanged historical inactive-area link on PUT, but cannot acquire a new inactive-area link. Editor detail includes that area's ID/name and `is_active: false` so an unrelated edit does not erase attribution; effective geometry still falls back to the active Site.
- DELETE means soft deactivation. Repeating DELETE on an existing inactive resource returns 204. Unknown IDs return 404. Inactive resources are not returned by ordinary GETs or editable via PUT; restoration/admin tooling is deferred. Deactivated species remain referenced by historical counts rather than deleting planting history.
- Full-form PUT is proposed to keep contract semantics simple. Concurrent edits currently use last-write-wins; optimistic concurrency is not silently promised by these interfaces.

Validate quantities as integers in `[0, Number.MAX_SAFE_INTEGER]`; reject fractional, negative and non-finite values. Validate `planting_date` as a real `YYYY-MM-DD` calendar date (year 1–9999), including leap years. Geometry requires finite WGS84 longitude/latitude in range, valid polygons and closed rings with at least four positions. Phase 1 accepts Points only; polygon editing remains a later enabled capability. Invalid inputs return 400, not silent coercion. Check derived totals against the same safe-integer bound; fail with a conflict error rather than return a rounded/unsafe number.

## Detail joins and aggregate meaning

- Site detail joins its Location, all visible areas/events and per-species actual totals across its full visible event history.
- Area detail joins its Site and Location, all visible matching events and full visible area totals. Site-only historical events are not assigned to an area implicitly.
- Species detail joins aggregate counts for this species and all visible events in which it was planted. Its total is for this species alone; a listed event's `total_plants` is that whole event's total, as on every other event list.
- Event detail joins its Site, optional Area, effective visible Location and every active event-species row with compact species display information. Its effective Location is the active, visible area's Location when available, otherwise the active Site's Location; it is read-only here and edited through Site/Area APIs.
- Rollups use active event/count rows and accessible sites/events. Historical deactivated species still contribute to actual quantities.
- Zero-count lines remain editable and visible in event detail but do not claim a species was planted. Species totals omit zero-only groups; SpeciesResponse event counts/history include positive matching quantities. Site/area event counts include all visible active events, including empty events.
- The contract requires joined results, not necessarily one giant SQL join. Aggregate each relationship independently or use appropriately grouped queries so a site with multiple events/areas/species never multiplies totals through join fan-out.

## Public and editor reads

The same read routes serve both audiences. Requests without a bearer token see public active records only; a valid bearer token for an active WRT user grants operational reads. An invalid or expired supplied token returns 401; the client clears it and may retry public reads without it. Signed-out preview uses a request without the token, not a query filter. Responses vary by viewer scope, so start with `Cache-Control: private, no-store` rather than sharing authenticated responses through public caches.

Publication rules apply before serialization, joins and rollups. For anonymous reads, a private or inactive Site hides its areas/events. Operational reads include private sites and their active children, but inactive sites and their children remain outside ordinary reads. An event may be public while its optional area is private: anonymous reads return `planting_area: null` and omit that area's geometry. Locations inherit their owner's visibility. Catalogue species details/images appear only if visible; otherwise retain quantities without private IDs/names. Merge unpublished species into a single null-species group in anonymous site/area rollups. Anonymous event detail similarly merges hidden quantities into one `UnpublishedSpeciesResponse` with `id: null` and `species: null`; published lines retain their IDs. Editors receive every actual line with its non-null ID and species reference, including retained inactive historical species. Historical area/species references carry `is_active` in event detail, without making inactive catalogue/area records available through ordinary direct GETs. Do not suppress actual quantities merely because catalogue publication differs.

`is_public` represents stored publication intent, not an independent override of parent visibility. Nested Site references include their publication flag so an editor can see that a checked area/event still has a private parent. An area's/event's effective publication is its own flag AND its site's flag, with both records active.

Inaccessible resources return 404, not their private names or existence details. Every nested reference and total follows the same scope as the containing response. Audit user IDs/emails never appear in domain responses. `created_at`/`updated_at` are safe resource timestamps, not complete raw audit rows. Frontend editing is enabled from the current authenticated user; the server remains authoritative.

## Minimal authentication endpoints

| Endpoint                    | Request                                             | Response                                                      |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| `GET /api/session`          | Optional bearer token; no body                      | 200 `SessionResponse`; `user: null` when no token is supplied |
| `POST /api/auth/magic-link` | `MagicLinkCreateRequest`                            | 202 `MagicLinkResponse`, generic account-independent message  |
| `POST /api/auth/callback`   | `AuthCallbackCreateRequest`, single-use login token | 200 `AuthCallbackResponse`                                    |

The email link opens the application's fixed sign-in route. That route reads the single-use login token into memory and immediately removes it from the URL with history replacement, on both success and failure. The sign-in page uses `Referrer-Policy: no-referrer` and loads no third-party resources before cleanup. After the user activates sign-in, the client submits the token in the callback POST body, stores the returned `access_token` and `expires_at` as client auth data, and navigates to the app. Requests authenticate with `Authorization: Bearer <access_token>`, not an HttpOnly session cookie. Auth responses use `Cache-Control: no-store`; login tokens and access tokens must not be logged. Proposed expiry defaults are 15 minutes for single-use login tokens and 8 hours from issuance for access tokens; the server enforces both, with no sliding renewal.

There is no logout endpoint. Signing out clears client auth data and cached operational responses, and subsequent requests omit the token. Client clearing does not revoke a copied token: it remains valid until its server-enforced expiry, subject to active-user checks on every authenticated request. No refresh-token or server-side logout flow is included in this minimal design.

Existing authorised users are provisioned outside this small domain API, with supplied IDs. No self-sign-up, general user CRUD or import endpoint is implied. The one-off historical import can use an internal script.

Missing, malformed, expired or consumed callback tokens, and users deactivated since issuance, return 401 `ErrorResponse` with the same generic sign-in failure message. They do not establish authentication or disclose which check failed. A successful callback consumes the login token and issues the expiring bearer token atomically. Invalid supplied bearer tokens return 401 on every authenticated request, including reads.

## Errors

All JSON errors use `ErrorResponse`: HTTP 400 validation errors, 401 invalid authentication or unauthenticated writes, 403 authenticated requests lacking authority, 404 unavailable resources, or 409 ID/ownership/lifecycle conflicts. A 204 has no JSON payload. Runtime/schema validation and static TypeScript compilation remain implementation work; these interfaces do not validate runtime requests.
