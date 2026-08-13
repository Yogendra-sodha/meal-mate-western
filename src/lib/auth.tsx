import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  default_servings: number;
  created_by: string;
}

export interface Member {
  user_id: string;
  role: string;
  name: string;
  email: string;
}

interface AuthValue {
  loading: boolean;
  householdLoaded: boolean;
  session: Session | null;
  user: User | null;
  household: Household | null;
  members: Member[];
  refresh: () => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  createHousehold: (name: string) => Promise<void>;
  joinHousehold: (code: string) => Promise<void>;
  leaveHousehold: (userId: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [householdLoaded, setHouseholdLoaded] = useState(false);

  const loadHousehold = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setHousehold(null);
      setMembers([]);
      return;
    }
    const { data: memberRows } = await supabase
      .from("household_members")
      .select("household_id, joined_at")
      .eq("user_id", userId)
      .order("joined_at", { ascending: true })
      .limit(1);
    const hid = memberRows?.[0]?.household_id;
    if (!hid) {
      setHousehold(null);
      setMembers([]);
      return;
    }
    const [{ data: h }, { data: ms }] = await Promise.all([
      supabase.from("households").select("*").eq("id", hid).maybeSingle(),
      supabase.from("household_members").select("user_id, role").eq("household_id", hid),
    ]);
    const ids = (ms ?? []).map((m) => m.user_id);
    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("id, name, email").in("id", ids)
      : { data: [] as { id: string; name: string; email: string }[] };
    setHousehold(h ? (h as Household) : null);
    setMembers(
      (ms ?? []).map((m) => {
        const p = profiles?.find((x) => x.id === m.user_id);
        return {
          user_id: m.user_id,
          role: m.role,
          name: p?.name || p?.email?.split("@")[0] || "Roommate",
          email: p?.email ?? "",
        };
      }),
    );
  }, []);

  useEffect(() => {
    let mounted = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    void loadHousehold(session?.user?.id);
  }, [session?.user?.id, loadHousehold]);

  const value = useMemo<AuthValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      household,
      members,
      refresh: () => loadHousehold(session?.user?.id),
      signUp: async (name, email, password) => {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
      },
      signIn: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      signOut: async () => {
        await supabase.auth.signOut();
        setHousehold(null);
        setMembers([]);
      },
      createHousehold: async (name) => {
        const uid = session?.user?.id;
        if (!uid) throw new Error("Not signed in");
        const { data, error } = await supabase
          .from("households")
          .insert({ name, invite_code: randomCode(), created_by: uid })
          .select()
          .single();
        if (error) throw error;
        const { error: mErr } = await supabase
          .from("household_members")
          .insert({ household_id: data.id, user_id: uid, role: "owner" });
        if (mErr) throw mErr;
        await loadHousehold(uid);
      },
      joinHousehold: async (code) => {
        const { error } = await supabase.rpc("join_household_by_code", { _code: code });
        if (error) throw error;
        await loadHousehold(session?.user?.id);
      },
      leaveHousehold: async (userId) => {
        if (!household) return;
        await supabase
          .from("household_members")
          .delete()
          .eq("household_id", household.id)
          .eq("user_id", userId);
        await loadHousehold(session?.user?.id);
      },
    }),
    [loading, session, household, members, loadHousehold],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
