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
