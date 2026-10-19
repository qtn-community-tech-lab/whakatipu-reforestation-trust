/** Proposed REST contracts over the current seven-table WRT schema. */
import type {
  Id,
  Timestamp,
  CalendarDate,
  Position,
  Geometry,
  PlantingEventType,
} from "./db-schema";
export type { Id, Timestamp, CalendarDate } from "./db-schema";

export interface SiteReferenceResponse {
  id: Id;
  name: string;
  /** Stored publication flag, useful when showing a child's publication state. */
  is_public: boolean;
}

export interface PlantingAreaReferenceResponse {
  id: Id;
  name: string;
}

export interface SpeciesReferenceResponse {
  id: Id;
  scientific_name: string;
  common_name: string;
  image_url: string;
}

export interface HistoricalPlantingAreaResponse extends PlantingAreaReferenceResponse {
  is_active: boolean;
}

export interface HistoricalSpeciesResponse extends SpeciesReferenceResponse {
  is_active: boolean;
}

/** Location has no independent publication or REST lifecycle. */
export interface LocationResponse {
  id: Id;
  geometry: Geometry;
}

/** Safe detail metadata, not raw database audit/user columns. */
export interface ResourceMetadataResponse {
  is_public: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PlantingTotalsResponse {
  planting_event_count: number;
  total_plants: number;
}

export interface SpeciesTotalResponse {
  /** Null for anonymous viewers when this catalogue record is unpublished/inactive. */
  species: SpeciesReferenceResponse | null;
  quantity: number;
}

// List items: enough for a row, card, dropdown or map pin, not an edit form.

export interface SiteListResponse extends SiteReferenceResponse {
  /** Point location or derived representative polygon point; no polygon payload. */
  position: Position | null;
}

export interface PlantingAreaListResponse extends PlantingAreaReferenceResponse {
  site: SiteReferenceResponse;
  position: Position | null;
  is_public: boolean;
}

export interface SpeciesListResponse extends SpeciesReferenceResponse {
  /** Needed for client-side name/alias search without loading every detail. */
  aliases: string[];
  is_public: boolean;
}

export interface PlantingEventListResponse {
  id: Id;
  site: SiteReferenceResponse;
  /** Null if unassigned or not visible to the viewer. */
  planting_area: PlantingAreaReferenceResponse | null;
  planting_date: CalendarDate;
  event_type: PlantingEventType;
  /** Positive-quantity species visible to the caller, for client-side filtering. */
  species_ids: Id[];
  total_plants: number;
  is_public: boolean;
}

// Detail payloads: joined page-ready data, without recursive full resources.

export interface SiteResponse
  extends SiteReferenceResponse, ResourceMetadataResponse {
  description: string;
  location: LocationResponse | null;
  totals: PlantingTotalsResponse;
  /** Complete rollup across visible events, including every event below. */
  species_totals: SpeciesTotalResponse[];
  /** Complete related array, restricted to records visible to the caller. */
  planting_areas: PlantingAreaListResponse[];
  /** Complete related array, restricted to records visible to the caller. */
  planting_events: PlantingEventListResponse[];
}

export interface PlantingAreaResponse
  extends PlantingAreaReferenceResponse, ResourceMetadataResponse {
  site: SiteReferenceResponse;
  description: string;
  location: LocationResponse | null;
  totals: PlantingTotalsResponse;
  species_totals: SpeciesTotalResponse[];
  /** Complete related array, restricted to records visible to the caller. */
  planting_events: PlantingEventListResponse[];
}

export interface SpeciesResponse
  extends SpeciesListResponse, ResourceMetadataResponse {
  description: string;
  /** total_plants counts this species only, not all plants in matching events. */
  totals: PlantingTotalsResponse;
  /** All visible active events with a positive quantity of this species. */
  planting_events: PlantingEventListResponse[];
}

export interface PlantingEventSpeciesLineResponse {
  /** The join row's ID, not the species ID. Needed when editing this event. */
  id: Id;
  /** Editors receive the reference even for retained inactive historical species. */
  species: HistoricalSpeciesResponse;
  quantity: number;
}

/** One anonymous aggregate, never private join IDs or distinct hidden lines. */
export interface UnpublishedSpeciesResponse {
  id: null;
  species: null;
  quantity: number;
}

export type PlantingEventSpeciesResponse =
  | PlantingEventSpeciesLineResponse
  | UnpublishedSpeciesResponse;

export interface PlantingEventResponse extends PlantingEventListResponse {
  /** Editors retain an inactive historical area reference for lossless form edits. */
  planting_area: HistoricalPlantingAreaResponse | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  notes: string;
  image_url: string;
  /** Visible active area location if present, otherwise the site's location. */
  location: LocationResponse | null;
  /** Complete editable line set for editors; public redactions merge into one line. */
  species: PlantingEventSpeciesResponse[];
}

// POST/PUT inputs: editable data only; server owns audit/deactivation fields.

export interface LocationUpdateRequest {
  /** Caller supplies this ID for a new location; preserve it on geometry edits. */
  id: Id;
  geometry: Geometry;
}

export interface SiteUpdateRequest {
  name: string;
  description: string;
  /** Null explicitly removes/deactivates the old location. */
  location: LocationUpdateRequest | null;
  is_public: boolean;
}

export interface SiteCreateRequest extends SiteUpdateRequest {
  id: Id;
}

export interface PlantingAreaUpdateRequest {
  /** Required on create and immutable on update in this first API. */
  site_id: Id;
  name: string;
  description: string;
  location: LocationUpdateRequest | null;
  is_public: boolean;
}

export interface PlantingAreaCreateRequest extends PlantingAreaUpdateRequest {
  id: Id;
}

export interface SpeciesUpdateRequest {
  scientific_name: string;
  common_name: string;
  aliases: string[];
  description: string;
  image_url: string;
  is_public: boolean;
}

export interface SpeciesCreateRequest extends SpeciesUpdateRequest {
  id: Id;
}

export interface PlantingEventSpeciesUpdateRequest {
  /** Caller-generated for new rows, retained from event detail for existing rows. */
  id: Id;
  species_id: Id;
  quantity: number;
}

export interface PlantingEventUpdateRequest {
  site_id: Id;
  planting_area_id: Id | null;
  planting_date: CalendarDate;
  event_type: PlantingEventType;
  notes: string;
  image_url: string;
  is_public: boolean;
  /** Complete desired active line set. Omitted existing rows are soft-deactivated. */
  species: PlantingEventSpeciesUpdateRequest[];
}

export interface PlantingEventCreateRequest extends PlantingEventUpdateRequest {
  id: Id;
}

// Minimal magic-link session contract; no general user-admin CRUD in this draft.

export interface CurrentUserResponse {
  id: Id;
  email: string;
  display_name: string;
}

export interface SessionResponse {
  user: CurrentUserResponse | null;
}

export interface MagicLinkCreateRequest {
  email: string;
}

export interface MagicLinkResponse {
  /** Same generic message whether or not this email is authorised. */
  message: string;
}

export interface AuthCallbackCreateRequest {
  token: string;
}

/** Send access_token as Authorization: Bearer <access_token>. */
export interface AuthCallbackResponse {
  access_token: string;
  expires_at: Timestamp;
  user: CurrentUserResponse;
}

export interface ErrorResponse {
  error: {
    code:
      | "validation_error"
      | "unauthenticated"
      | "forbidden"
      | "not_found"
      | "conflict";
    message: string;
    /** Optional field-path errors, e.g. { "species.0.quantity": "Must be >= 0" }. */
    fields?: Record<string, string>;
  };
}
