export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      ai_assessments: {
        Row: {
          created_at: string
          engine: string
          findings: Json
          id: string
          project_id: string
          risk_level: string
          risk_score: number
          summary: string | null
        }
        Insert: {
          created_at?: string
          engine?: string
          findings?: Json
          id?: string
          project_id: string
          risk_level?: string
          risk_score?: number
          summary?: string | null
        }
        Update: {
          created_at?: string
          engine?: string
          findings?: Json
          id?: string
          project_id?: string
          risk_level?: string
          risk_score?: number
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_assessments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          comments: string | null
          created_at: string
          id: string
          new_status: string | null
          previous_status: string | null
          project_code: string | null
          project_id: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          comments?: string | null
          created_at?: string
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_code?: string | null
          project_id?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          comments?: string | null
          created_at?: string
          id?: string
          new_status?: string | null
          previous_status?: string | null
          project_code?: string | null
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      blockchain_records: {
        Row: {
          anchored_payload: Json | null
          block_number: number | null
          created_at: string
          id: string
          network: string
          project_id: string
          record_hash: string
          status: string
          tx_hash: string
          verified_tco2e: number | null
          verifier_id: string | null
        }
        Insert: {
          anchored_payload?: Json | null
          block_number?: number | null
          created_at?: string
          id?: string
          network?: string
          project_id: string
          record_hash: string
          status?: string
          tx_hash: string
          verified_tco2e?: number | null
          verifier_id?: string | null
        }
        Update: {
          anchored_payload?: Json | null
          block_number?: number | null
          created_at?: string
          id?: string
          network?: string
          project_id?: string
          record_hash?: string
          status?: string
          tx_hash?: string
          verified_tco2e?: number | null
          verifier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blockchain_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      carbon_impact_records: {
        Row: {
          created_at: string
          estimated_tco2e: number | null
          id: string
          methodology: string
          project_id: string
          verified_at: string
          verified_by: string | null
          verified_tco2e: number | null
        }
        Insert: {
          created_at?: string
          estimated_tco2e?: number | null
          id?: string
          methodology?: string
          project_id: string
          verified_at?: string
          verified_by?: string | null
          verified_tco2e?: number | null
        }
        Update: {
          created_at?: string
          estimated_tco2e?: number | null
          id?: string
          methodology?: string
          project_id?: string
          verified_at?: string
          verified_by?: string | null
          verified_tco2e?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "carbon_impact_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      community_posts: {
        Row: {
          author_email: string | null
          author_id: string
          author_name: string
          body: string | null
          created_at: string
          id: string
          latitude: number | null
          longitude: number | null
          media_type: string
          media_url: string | null
          moderated_at: string | null
          moderated_by: string | null
          moderator_note: string | null
          place_name: string | null
          project_id: string | null
          status: Database["public"]["Enums"]["community_post_status"]
          title: string
          updated_at: string
        }
        Insert: {
          author_email?: string | null
          author_id: string
          author_name: string
          body?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          media_type?: string
          media_url?: string | null
          moderated_at?: string | null
          moderated_by?: string | null
          moderator_note?: string | null
          place_name?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["community_post_status"]
          title: string
          updated_at?: string
        }
        Update: {
          author_email?: string | null
          author_id?: string
          author_name?: string
          body?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          media_type?: string
          media_url?: string | null
          moderated_at?: string | null
          moderated_by?: string | null
          moderator_note?: string | null
          place_name?: string | null
          project_id?: string | null
          status?: Database["public"]["Enums"]["community_post_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "community_posts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence: {
        Row: {
          capture_date: string | null
          created_at: string
          evidence_code: string | null
          evidence_type: string
          file_hash: string | null
          file_name: string
          file_size: number | null
          file_url: string | null
          id: string
          is_public: boolean
          latitude: number | null
          longitude: number | null
          project_id: string
          review_status: string
          reviewer_comment: string | null
          uploaded_by: string | null
          uploaded_by_email: string | null
        }
        Insert: {
          capture_date?: string | null
          created_at?: string
          evidence_code?: string | null
          evidence_type?: string
          file_hash?: string | null
          file_name: string
          file_size?: number | null
          file_url?: string | null
          id?: string
          is_public?: boolean
          latitude?: number | null
          longitude?: number | null
          project_id: string
          review_status?: string
          reviewer_comment?: string | null
          uploaded_by?: string | null
          uploaded_by_email?: string | null
        }
        Update: {
          capture_date?: string | null
          created_at?: string
          evidence_code?: string | null
          evidence_type?: string
          file_hash?: string | null
          file_name?: string
          file_size?: number | null
          file_url?: string | null
          id?: string
          is_public?: boolean
          latitude?: number | null
          longitude?: number | null
          project_id?: string
          review_status?: string
          reviewer_comment?: string | null
          uploaded_by?: string | null
          uploaded_by_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_interests: {
        Row: {
          company_name: string
          contact_email: string
          contact_name: string
          contact_phone: string | null
          created_at: string
          id: string
          intended_use: string | null
          message: string | null
          project_id: string
          requested_tco2e: number | null
          requester_id: string
          status: Database["public"]["Enums"]["interest_status"]
          updated_at: string
        }
        Insert: {
          company_name: string
          contact_email: string
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          intended_use?: string | null
          message?: string | null
          project_id: string
          requested_tco2e?: number | null
          requester_id: string
          status?: Database["public"]["Enums"]["interest_status"]
          updated_at?: string
        }
        Update: {
          company_name?: string
          contact_email?: string
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          intended_use?: string | null
          message?: string | null
          project_id?: string
          requested_tco2e?: number | null
          requester_id?: string
          status?: Database["public"]["Enums"]["interest_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_interests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          project_id: string | null
          read: boolean
          recipient_email: string
          title: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          project_id?: string | null
          read?: boolean
          recipient_email: string
          title: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          project_id?: string | null
          read?: boolean
          recipient_email?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          organization: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          organization?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          organization?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_timeline: {
        Row: {
          actor_email: string | null
          created_at: string
          detail: string | null
          id: string
          label: string
          project_id: string
        }
        Insert: {
          actor_email?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          label: string
          project_id: string
        }
        Update: {
          actor_email?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          label?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_timeline_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          area_hectares: number | null
          coastal_area: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          description: string | null
          district: string | null
          ecosystem: Database["public"]["Enums"]["ecosystem_type"]
          estimated_carbon: number | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          notes: string | null
          organization: string | null
          owner_email: string
          owner_id: string | null
          owner_name: string | null
          plant_count: number | null
          project_code: string
          restoration_end: string | null
          restoration_method: string | null
          restoration_start: string | null
          species: string | null
          state: string | null
          status: Database["public"]["Enums"]["project_status"]
          submitted_at: string | null
          survival_rate: number | null
          updated_at: string
          verified_at: string | null
          verified_carbon: number | null
          verifier_id: string | null
          verifier_name: string | null
        }
        Insert: {
          area_hectares?: number | null
          coastal_area?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          district?: string | null
          ecosystem?: Database["public"]["Enums"]["ecosystem_type"]
          estimated_carbon?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          notes?: string | null
          organization?: string | null
          owner_email: string
          owner_id?: string | null
          owner_name?: string | null
          plant_count?: number | null
          project_code: string
          restoration_end?: string | null
          restoration_method?: string | null
          restoration_start?: string | null
          species?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          submitted_at?: string | null
          survival_rate?: number | null
          updated_at?: string
          verified_at?: string | null
          verified_carbon?: number | null
          verifier_id?: string | null
          verifier_name?: string | null
        }
        Update: {
          area_hectares?: number | null
          coastal_area?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: string | null
          district?: string | null
          ecosystem?: Database["public"]["Enums"]["ecosystem_type"]
          estimated_carbon?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          notes?: string | null
          organization?: string | null
          owner_email?: string
          owner_id?: string | null
          owner_name?: string | null
          plant_count?: number | null
          project_code?: string
          restoration_end?: string | null
          restoration_method?: string | null
          restoration_start?: string | null
          species?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          submitted_at?: string | null
          survival_rate?: number | null
          updated_at?: string
          verified_at?: string | null
          verified_carbon?: number | null
          verifier_id?: string | null
          verifier_name?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      validation_results: {
        Row: {
          checks: Json
          created_at: string
          id: string
          project_id: string
          score: number
        }
        Insert: {
          checks?: Json
          created_at?: string
          id?: string
          project_id: string
          score?: number
        }
        Update: {
          checks?: Json
          created_at?: string
          id?: string
          project_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "validation_results_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_reviews: {
        Row: {
          comments: string | null
          confirmed_carbon: number | null
          created_at: string
          decision: string
          id: string
          project_id: string
          verifier_email: string | null
          verifier_id: string | null
        }
        Insert: {
          comments?: string | null
          confirmed_carbon?: number | null
          created_at?: string
          decision: string
          id?: string
          project_id: string
          verifier_email?: string | null
          verifier_id?: string | null
        }
        Update: {
          comments?: string | null
          confirmed_carbon?: number | null
          created_at?: string
          decision?: string
          id?: string
          project_id?: string
          verifier_email?: string | null
          verifier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_public_project: { Args: { _code: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_verifier: { Args: never; Returns: boolean }
      list_public_projects: { Args: never; Returns: Json }
      next_project_code: {
        Args: { _eco: Database["public"]["Enums"]["ecosystem_type"] }
        Returns: string
      }
      owns_project: { Args: { _project_id: string }; Returns: boolean }
      project_visible: { Args: { _project_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "project_owner" | "verifier" | "admin"
      community_post_status: "PENDING" | "APPROVED" | "REJECTED"
      ecosystem_type:
        | "MANGROVE"
        | "SEAGRASS"
        | "SALT_MARSH"
        | "COASTAL_WETLAND"
        | "OTHER"
      interest_status: "NEW" | "IN_DISCUSSION" | "CLOSED"
      project_status:
        | "DRAFT"
        | "SUBMITTED"
        | "UNDER_REVIEW"
        | "CORRECTION_REQUIRED"
        | "VERIFIED"
        | "REJECTED"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["project_owner", "verifier", "admin"],
      community_post_status: ["PENDING", "APPROVED", "REJECTED"],
      ecosystem_type: [
        "MANGROVE",
        "SEAGRASS",
        "SALT_MARSH",
        "COASTAL_WETLAND",
        "OTHER",
      ],
      interest_status: ["NEW", "IN_DISCUSSION", "CLOSED"],
      project_status: [
        "DRAFT",
        "SUBMITTED",
        "UNDER_REVIEW",
        "CORRECTION_REQUIRED",
        "VERIFIED",
        "REJECTED",
      ],
    },
  },
} as const
