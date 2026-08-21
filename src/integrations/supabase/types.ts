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
      app_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      vato: {
        Row: {
          created_at: string
          id: string
          position: number
          reference: string
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          reference?: string
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          reference?: string
          text?: string
        }
        Relationships: []
      }
      cook_log: {
        Row: {
          created_at: string
          date: string
          household_id: string
          id: string
          recipe_ref: string
        }
        Insert: {
          created_at?: string
          date: string
          household_id: string
          id?: string
          recipe_ref: string
        }
        Update: {
          created_at?: string
          date?: string
          household_id?: string
          id?: string
          recipe_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "cook_log_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      cooking_tasks: {
        Row: {
          assigned_to: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
          created_by: string | null
          date: string
          household_id: string
          id: string
          kind: string
          name: string
          recipe_ref: string | null
          task_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          date: string
          household_id: string
          id?: string
          kind?: string
          name: string
          recipe_ref?: string | null
          task_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          household_id?: string
          id?: string
          kind?: string
          name?: string
          recipe_ref?: string | null
          task_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cooking_tasks_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      grocery_checks: {
        Row: {
          household_id: string
          item_key: string
          purchased: boolean
        }
        Insert: {
          household_id: string
          item_key: string
          purchased?: boolean
        }
        Update: {
          household_id?: string
          item_key?: string
          purchased?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "grocery_checks_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      grocery_items: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          created_by: string | null
          household_id: string
          id: string
          name: string
          purchased: boolean
          qty: number
          recipe_title: string | null
          unit: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          household_id: string
          id?: string
          name: string
          purchased?: boolean
          qty?: number
          recipe_title?: string | null
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          household_id?: string
          id?: string
          name?: string
          purchased?: boolean
          qty?: number
          recipe_title?: string | null
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grocery_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          household_id: string
          id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          household_id: string
          id?: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          household_id?: string
          id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          created_by: string
          default_servings: number
          id: string
          invite_code: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          default_servings?: number
          id?: string
          invite_code: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          default_servings?: number
          id?: string
          invite_code?: string
          name?: string
        }
        Relationships: []
      }
      meal_plan_items: {
        Row: {
          id: string
          meal_plan_id: string
          position: number
          recipe_ref: string
        }
        Insert: {
          id?: string
          meal_plan_id: string
          position?: number
          recipe_ref: string
        }
        Update: {
          id?: string
          meal_plan_id?: string
          position?: number
          recipe_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_plan_items_meal_plan_id_fkey"
            columns: ["meal_plan_id"]
            isOneToOne: false
            referencedRelation: "meal_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      meal_plans: {
        Row: {
          cooked: boolean
          date: string
          household_id: string
          id: string
          note: string | null
          servings: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cooked?: boolean
          date: string
          household_id: string
          id?: string
          note?: string | null
          servings?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cooked?: boolean
          date?: string
          household_id?: string
          id?: string
          note?: string | null
          servings?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meal_plans_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      pantry_items: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          household_id: string
          id: string
          name: string
          qty: number
          recurring: boolean
          unit: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          household_id: string
          id?: string
          name: string
          qty?: number
          recurring?: boolean
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          household_id?: string
          id?: string
          name?: string
          qty?: number
          recurring?: boolean
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pantry_items_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          email?: string
          id: string
          name?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      recipe_favorites: {
        Row: {
          household_id: string
          recipe_ref: string
        }
        Insert: {
          household_id: string
          recipe_ref: string
        }
        Update: {
          household_id?: string
          recipe_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_favorites_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ingredients: {
        Row: {
          category: string
          id: string
          name: string
          position: number
          qty: number
          recipe_id: string
          staple: boolean
          unit: string
        }
        Insert: {
          category?: string
          id?: string
          name: string
          position?: number
          qty?: number
          recipe_id: string
          staple?: boolean
          unit?: string
        }
        Update: {
          category?: string
          id?: string
          name?: string
          position?: number
          qty?: number
          recipe_id?: string
          staple?: boolean
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_ratings: {
        Row: {
          household_id: string
          recipe_ref: string
          user_id: string
          value: number
        }
        Insert: {
          household_id: string
          recipe_ref: string
          user_id: string
          value?: number
        }
        Update: {
          household_id?: string
          recipe_ref?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ratings_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          cook_min: number
          cooking_instructions: string[]
          created_at: string
          created_by: string | null
          cuisine: string
          description: string
          household_id: string
          id: string
          name: string
          prep_min: number
          preparation_instructions: string[]
          servings: number
          slug: string
          source_name: string
          source_url: string
          tags: string[]
          updated_at: string
          updated_by: string | null
          video_url: string | null
        }
        Insert: {
          cook_min?: number
          cooking_instructions?: string[]
          created_at?: string
          created_by?: string | null
          cuisine?: string
          description?: string
          household_id: string
          id?: string
          name: string
          prep_min?: number
          preparation_instructions?: string[]
          servings?: number
          slug: string
          source_name?: string
          source_url?: string
          tags?: string[]
          updated_at?: string
          updated_by?: string | null
          video_url?: string | null
        }
        Update: {
          cook_min?: number
          cooking_instructions?: string[]
          created_at?: string
          created_by?: string | null
          cuisine?: string
          description?: string
          household_id?: string
          id?: string
          name?: string
          prep_min?: number
          preparation_instructions?: string[]
          servings?: number
          slug?: string
          source_name?: string
          source_url?: string
          tags?: string[]
          updated_at?: string
          updated_by?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipes_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_household_overview: { Args: Record<string, never>; Returns: Json }
      is_app_admin: { Args: Record<string, never>; Returns: boolean }
      is_household_member: { Args: { _household_id: string }; Returns: boolean }
      join_household_by_code: { Args: { _code: string }; Returns: string }
      shares_household: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
