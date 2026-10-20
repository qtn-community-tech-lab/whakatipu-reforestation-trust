export type Json = string | number | boolean | null | {
  [key: string]: Json | undefined;
} | Json[];

export type Database = {
  "public": {
    Tables: {
      "locations": {
        Row: {
          "created_at": string;
          "created_by": string;
          "deactivated_at": string | null;
          "geometry": NonNullable<Json>;
          "id": string;
          "updated_at": string;
          "updated_by": string;
        };
        ComputedFields: never;
        Insert: {
          "created_at"?: string;
          "created_by": string;
          "deactivated_at"?: string | null;
          "geometry": NonNullable<Json>;
          "id": string;
          "updated_at"?: string;
          "updated_by": string;
        };
        Update: {
          "created_at"?: string;
          "created_by"?: string;
          "deactivated_at"?: string | null;
          "geometry"?: NonNullable<Json>;
          "id"?: string;
          "updated_at"?: string;
          "updated_by"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "locations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "locations_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      "planting_areas": {
        Row: {
          "created_at": string;
          "created_by": string;
          "deactivated_at": string | null;
          "description": string;
          "id": string;
          "is_public": boolean;
          "location_id": string | null;
          "name": string;
          "site_id": string;
          "updated_at": string;
          "updated_by": string;
        };
        ComputedFields: never;
        Insert: {
          "created_at"?: string;
          "created_by": string;
          "deactivated_at"?: string | null;
          "description"?: string;
          "id": string;
          "is_public"?: boolean;
          "location_id"?: string | null;
          "name": string;
          "site_id": string;
          "updated_at"?: string;
          "updated_by": string;
        };
        Update: {
          "created_at"?: string;
          "created_by"?: string;
          "deactivated_at"?: string | null;
          "description"?: string;
          "id"?: string;
          "is_public"?: boolean;
          "location_id"?: string | null;
          "name"?: string;
          "site_id"?: string;
          "updated_at"?: string;
          "updated_by"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "planting_areas_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planting_areas_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: true;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planting_areas_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planting_areas_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      "planting_event_species": {
        Row: {
          "created_at": string;
          "created_by": string;
          "deactivated_at": string | null;
          "id": string;
          "planting_event_id": string;
          "quantity": number;
          "species_id": string;
          "updated_at": string;
          "updated_by": string;
        };
        ComputedFields: never;
        Insert: {
          "created_at"?: string;
          "created_by": string;
          "deactivated_at"?: string | null;
          "id": string;
          "planting_event_id": string;
          "quantity": number;
          "species_id": string;
          "updated_at"?: string;
          "updated_by": string;
        };
        Update: {
          "created_at"?: string;
          "created_by"?: string;
          "deactivated_at"?: string | null;
          "id"?: string;
          "planting_event_id"?: string;
          "quantity"?: number;
          "species_id"?: string;
          "updated_at"?: string;
          "updated_by"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "planting_event_species_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planting_event_species_planting_event_id_fkey";
            columns: ["planting_event_id"];
            isOneToOne: false;
            referencedRelation: "planting_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planting_event_species_species_id_fkey";
            columns: ["species_id"];
            isOneToOne: false;
            referencedRelation: "species";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planting_event_species_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      "planting_events": {
        Row: {
          "created_at": string;
          "created_by": string;
          "deactivated_at": string | null;
          "event_type": string;
          "id": string;
          "image_url": string;
          "is_public": boolean;
          "notes": string;
          "planting_area_id": string | null;
          "planting_date": string;
          "season": string;
          "site_id": string;
          "updated_at": string;
          "updated_by": string;
        };
        ComputedFields: never;
        Insert: {
          "created_at"?: string;
          "created_by": string;
          "deactivated_at"?: string | null;
          "event_type": string;
          "id": string;
          "image_url"?: string;
          "is_public"?: boolean;
          "notes"?: string;
          "planting_area_id"?: string | null;
          "planting_date": string;
          "season"?: string;
          "site_id": string;
          "updated_at"?: string;
          "updated_by": string;
        };
        Update: {
          "created_at"?: string;
          "created_by"?: string;
          "deactivated_at"?: string | null;
          "event_type"?: string;
          "id"?: string;
          "image_url"?: string;
          "is_public"?: boolean;
          "notes"?: string;
          "planting_area_id"?: string | null;
          "planting_date"?: string;
          "season"?: string;
          "site_id"?: string;
          "updated_at"?: string;
          "updated_by"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "planting_events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planting_events_planting_area_id_fkey";
            columns: ["planting_area_id"];
            isOneToOne: false;
            referencedRelation: "planting_areas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planting_events_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "planting_events_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      "sites": {
        Row: {
          "created_at": string;
          "created_by": string;
          "deactivated_at": string | null;
          "description": string;
          "id": string;
          "is_public": boolean;
          "location_id": string | null;
          "name": string;
          "updated_at": string;
          "updated_by": string;
        };
        ComputedFields: never;
        Insert: {
          "created_at"?: string;
          "created_by": string;
          "deactivated_at"?: string | null;
          "description"?: string;
          "id": string;
          "is_public"?: boolean;
          "location_id"?: string | null;
          "name": string;
          "updated_at"?: string;
          "updated_by": string;
        };
        Update: {
          "created_at"?: string;
          "created_by"?: string;
          "deactivated_at"?: string | null;
          "description"?: string;
          "id"?: string;
          "is_public"?: boolean;
          "location_id"?: string | null;
          "name"?: string;
          "updated_at"?: string;
          "updated_by"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sites_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sites_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: true;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sites_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      "species": {
        Row: {
          "aliases": (string)[];
          "common_name": string;
          "created_at": string;
          "created_by": string;
          "deactivated_at": string | null;
          "description": string;
          "id": string;
          "image_url": string;
          "is_public": boolean;
          "scientific_name": string;
          "updated_at": string;
          "updated_by": string;
        };
        ComputedFields: never;
        Insert: {
          "aliases"?: (string)[];
          "common_name": string;
          "created_at"?: string;
          "created_by": string;
          "deactivated_at"?: string | null;
          "description"?: string;
          "id": string;
          "image_url"?: string;
          "is_public"?: boolean;
          "scientific_name": string;
          "updated_at"?: string;
          "updated_by": string;
        };
        Update: {
          "aliases"?: (string)[];
          "common_name"?: string;
          "created_at"?: string;
          "created_by"?: string;
          "deactivated_at"?: string | null;
          "description"?: string;
          "id"?: string;
          "image_url"?: string;
          "is_public"?: boolean;
          "scientific_name"?: string;
          "updated_at"?: string;
          "updated_by"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "species_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "species_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      "users": {
        Row: {
          "auth_user_id": string | null;
          "created_at": string;
          "created_by": string;
          "deactivated_at": string | null;
          "display_name": string;
          "email": string;
          "id": string;
          "updated_at": string;
          "updated_by": string;
        };
        ComputedFields: never;
        Insert: {
          "auth_user_id"?: string | null;
          "created_at"?: string;
          "created_by": string;
          "deactivated_at"?: string | null;
          "display_name": string;
          "email": string;
          "id": string;
          "updated_at"?: string;
          "updated_by": string;
        };
        Update: {
          "auth_user_id"?: string | null;
          "created_at"?: string;
          "created_by"?: string;
          "deactivated_at"?: string | null;
          "display_name"?: string;
          "email"?: string;
          "id"?: string;
          "updated_at"?: string;
          "updated_by"?: string;
        };
        Relationships: [
          {
            foreignKeyName: "users_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "users_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      "planting_area_create": {
        Args: {
          "p_actor_id": string;
          "p_description": string;
          "p_geometry": Json;
          "p_id": string;
          "p_is_public": boolean;
          "p_location_id": string;
          "p_name": string;
          "p_site_id": string;
        };
        Returns:
          Database["public"]["CompositeTypes"]["planting_area_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "planting_area_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      "planting_area_deactivate": {
        Args: { "p_actor_id": string; "p_id": string };
        Returns: undefined;
      };
      "planting_area_get": {
        Args: { "p_id": string };
        Returns:
          Database["public"]["CompositeTypes"]["planting_area_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "planting_area_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      "planting_area_update": {
        Args: {
          "p_actor_id": string;
          "p_description": string;
          "p_geometry": Json;
          "p_id": string;
          "p_is_public": boolean;
          "p_location_id": string;
          "p_name": string;
          "p_site_id": string;
        };
        Returns:
          Database["public"]["CompositeTypes"]["planting_area_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "planting_area_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      "planting_event_deactivate": {
        Args: { "p_actor_id": string; "p_id": string };
        Returns: undefined;
      };
      "planting_event_get": {
        Args: { "p_id": string };
        Returns:
          Database["public"]["CompositeTypes"]["planting_event_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "planting_event_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      "planting_event_list": {
        Args: Record<PropertyKey, never>;
        Returns: {
          "events":
            (Database["public"]["CompositeTypes"]["species_event_row"])[];
        }[];
      };
      "planting_event_save": {
        Args: {
          "p_actor_id": string;
          "p_create": boolean;
          "p_event_type": string;
          "p_id": string;
          "p_image_url": string;
          "p_is_public": boolean;
          "p_notes": string;
          "p_planting_area_id": string;
          "p_planting_date": string;
          "p_season": string;
          "p_site_id": string;
          "p_species": Json;
        };
        Returns:
          Database["public"]["CompositeTypes"]["planting_event_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "planting_event_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      "site_create": {
        Args: {
          "p_actor_id": string;
          "p_description": string;
          "p_geometry": Json;
          "p_id": string;
          "p_is_public": boolean;
          "p_location_id": string;
          "p_name": string;
        };
        Returns: Database["public"]["CompositeTypes"]["site_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "site_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      "site_deactivate": {
        Args: { "p_actor_id": string; "p_id": string };
        Returns: undefined;
      };
      "site_get": {
        Args: { "p_id": string };
        Returns: Database["public"]["CompositeTypes"]["site_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "site_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      "site_update": {
        Args: {
          "p_actor_id": string;
          "p_description": string;
          "p_geometry": Json;
          "p_id": string;
          "p_is_public": boolean;
          "p_location_id": string;
          "p_name": string;
        };
        Returns: Database["public"]["CompositeTypes"]["site_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "site_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      "species_create": {
        Args: {
          "p_actor_id": string;
          "p_aliases": (string)[];
          "p_common_name": string;
          "p_description": string;
          "p_id": string;
          "p_image_url": string;
          "p_is_public": boolean;
          "p_scientific_name": string;
        };
        Returns: Database["public"]["CompositeTypes"]["species_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "species_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      "species_deactivate": {
        Args: { "p_actor_id": string; "p_id": string };
        Returns: undefined;
      };
      "species_get": {
        Args: { "p_id": string };
        Returns: Database["public"]["CompositeTypes"]["species_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "species_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      "species_update": {
        Args: {
          "p_actor_id": string;
          "p_aliases": (string)[];
          "p_common_name": string;
          "p_description": string;
          "p_id": string;
          "p_image_url": string;
          "p_is_public": boolean;
          "p_scientific_name": string;
        };
        Returns: Database["public"]["CompositeTypes"]["species_detail_rows"][];
        SetofOptions: {
          from: "*";
          to: "species_detail_rows";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      "event_species_row": {
        "id": string | null;
        "species": Database["public"]["Tables"]["species"]["Row"] | null;
        "quantity": number | null;
      };
      "planting_area_detail_rows": {
        "area": Database["public"]["Tables"]["planting_areas"]["Row"] | null;
        "site": Database["public"]["Tables"]["sites"]["Row"] | null;
        "location": Database["public"]["Tables"]["locations"]["Row"] | null;
        "total_plants": number | null;
        "planting_event_count": number | null;
        "species_totals":
          | (Database["public"]["CompositeTypes"]["site_species_total_row"])[]
          | null;
        "events":
          | (Database["public"]["CompositeTypes"]["species_event_row"])[]
          | null;
      };
      "planting_event_detail_rows": {
        "event": Database["public"]["Tables"]["planting_events"]["Row"] | null;
        "site": Database["public"]["Tables"]["sites"]["Row"] | null;
        "area": Database["public"]["Tables"]["planting_areas"]["Row"] | null;
        "location": Database["public"]["Tables"]["locations"]["Row"] | null;
        "total_plants": number | null;
        "lines":
          | (Database["public"]["CompositeTypes"]["event_species_row"])[]
          | null;
      };
      "site_area_row": {
        "id": string | null;
        "name": string | null;
        "is_public": boolean | null;
        "geometry": Json | null;
      };
      "site_detail_rows": {
        "site": Database["public"]["Tables"]["sites"]["Row"] | null;
        "location": Database["public"]["Tables"]["locations"]["Row"] | null;
        "total_plants": number | null;
        "planting_event_count": number | null;
        "species_totals":
          | (Database["public"]["CompositeTypes"]["site_species_total_row"])[]
          | null;
        "areas":
          | (Database["public"]["CompositeTypes"]["site_area_row"])[]
          | null;
        "events":
          | (Database["public"]["CompositeTypes"]["species_event_row"])[]
          | null;
      };
      "site_species_total_row": {
        "species": Database["public"]["Tables"]["species"]["Row"] | null;
        "quantity": number | null;
      };
      "species_detail_rows": {
        "species": Database["public"]["Tables"]["species"]["Row"] | null;
        "total_plants": number | null;
        "planting_event_count": number | null;
        "events":
          | (Database["public"]["CompositeTypes"]["species_event_row"])[]
          | null;
      };
      "species_event_row": {
        "id": string | null;
        "site_id": string | null;
        "site_name": string | null;
        "site_is_public": boolean | null;
        "planting_area_id": string | null;
        "planting_area_name": string | null;
        "planting_date": string | null;
        "event_type": string | null;
        "species_ids": (string)[] | null;
        "total_plants": number | null;
        "is_public": boolean | null;
        "season": string | null;
        "image_url": string | null;
      };
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema =
  DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof (
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Tables"
      ]
      & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
        "Views"
      ]
    )
    : never = never,
> = DefaultSchemaTableNameOrOptions extends
  { schema: keyof DatabaseWithoutInternals } ? (
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Views"
    ]
  )[TableName] extends {
    Row: infer R;
  } ? R
  : never
  : DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[
      DefaultSchemaTableNameOrOptions
    ] extends {
      Row: infer R;
    } ? R
    : never
  : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends
  { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Insert: infer I;
  } ? I
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I;
    } ? I
    : never
  : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
      "Tables"
    ]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends
  { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]][
    "Tables"
  ][TableName] extends {
    Update: infer U;
  } ? U
  : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U;
    } ? U
    : never
  : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]][
      "Enums"
    ]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends
  { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][
    EnumName
  ]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  } ? keyof DatabaseWithoutInternals[
      PublicCompositeTypeNameOrOptions["schema"]
    ]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends
  { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]][
    "CompositeTypes"
  ][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never;

export const Constants = {
  "public": {
    Enums: {},
  },
} as const;
