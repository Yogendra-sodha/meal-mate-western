import { createFileRoute } from "@tanstack/react-router";
import { Home, RefreshCw, ShieldCheck, Users, Utensils } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { PageHeader, Screen } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Bachelor Dinner Planner" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Admin,
});

interface AdminMember {
  user_id: string;
  name: string;
  email: string;
  role: string;
  joined_at: string;
}

interface AdminHousehold {
  id: string;
  name: string;
  invite_code: string;
  default_servings: number;
  created_at: string;
  created_by: string;
  recipe_count: number;
  meal_plan_count: number;
  grocery_count: number;
  pantry_count: number;
  members: AdminMember[];
}

function Admin() {
  const { isAdmin, loading } = useAuth();
  const [households, setHouseholds] = useState<AdminHousehold[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("admin_household_overview");
    if (rpcError) {
      setError(rpcError.message);
      setHouseholds(null);
    } else {
      const payload = data as unknown as { households?: AdminHousehold[] } | null;
      setHouseholds(payload?.households ?? []);
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (loading) {
    return (
      <Screen>
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      </Screen>
    );
  }

  // The server rejects non-admins regardless; this only avoids a pointless call.
  if (!isAdmin) {
    return (
      <Screen>
        <PageHeader title="Admin" subtitle="Restricted area" />
        <div className="surface-card p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            This account does not have admin access.
          </p>
        </div>
      </Screen>
    );
  }

  const totalMembers = (households ?? []).reduce((sum, h) => sum + h.members.length, 0);

  return (
    <Screen>
      <PageHeader
        title="Admin"
        subtitle="Every household on this deployment"
        action={
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        }
      />

      {error ? (
        <div className="surface-card mb-4 p-4">
          <p className="text-sm font-semibold text-destructive">Could not load</p>
          <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
      ) : null}

      {households ? (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Stat icon={<Home className="h-4 w-4" />} label="Households" value={households.length} />
          <Stat icon={<Users className="h-4 w-4" />} label="Members" value={totalMembers} />
        </div>
      ) : null}

      {households === null && !error ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading households…</p>
      ) : null}

      {households?.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No households yet.</p>
      ) : null}

      <ul className="space-y-3">
        {(households ?? []).map((h) => (
          <li key={h.id} className="surface-card p-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <p className="truncate font-bold">{h.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Created {new Date(h.created_at).toLocaleDateString()} • {h.default_servings} plates
                  by default
                </p>
              </div>
              <code className="shrink-0 rounded-full bg-primary-container px-3 py-1 text-xs font-bold tracking-wider text-primary-container-foreground">
                {h.invite_code}
              </code>
            </div>

            <p className="mt-3 inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Utensils className="h-3.5 w-3.5" /> {h.recipe_count} recipes
              </span>
              <span>{h.meal_plan_count} planned days</span>
              <span>{h.grocery_count} grocery</span>
              <span>{h.pantry_count} pantry</span>
            </p>

            <ul className="mt-3 space-y-1.5 border-t border-border pt-3">
              {h.members.map((m) => (
                <li
                  key={m.user_id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{m.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="surface-card p-4">
      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
