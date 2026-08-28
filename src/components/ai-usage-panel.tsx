import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

interface Settings {
  household_id: string;
  enabled: boolean;
  daily_calls_per_user: number;
  monthly_cost_cap_cents: number;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
}

interface UsageRow {
  id: string;
  user_id: string | null;
  created_at: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_cents: number;
  outcome: string;
}

const money = (cents: number) =>
  (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

const startOfMonthIso = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
};

/**
 * What the AI import has cost this month, and the controls over it.
 *
 * The numbers come from ai_usage, which only the database writes, so this
 * reports what was actually spent rather than what the app believes it spent.
 */
export function AiUsagePanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [settingsRes, usageRes, profileRes] = await Promise.all([
      supabase
        .from("ai_settings")
        .select(
          "household_id, enabled, daily_calls_per_user, monthly_cost_cap_cents, input_cost_per_mtok, output_cost_per_mtok",
        )
        .limit(1)
        .maybeSingle(),
      supabase
        .from("ai_usage")
        .select(
          "id, user_id, created_at, model, prompt_tokens, completion_tokens, cost_cents, outcome",
        )
        .gte("created_at", startOfMonthIso())
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("profiles").select("id, name"),
    ]);
    setSettings(settingsRes.data ?? null);
    setRows(usageRes.data ?? []);
    setNames(Object.fromEntries((profileRes.data ?? []).map((p) => [p.id, p.name])));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (values: Partial<Settings>) => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from("ai_settings")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("household_id", settings.household_id);
    setSaving(false);
    if (error) {
      toast.error("Could not save that setting");
      return;
    }
    setSettings({ ...settings, ...values });
    toast.success("Saved");
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading usage…</p>;

  if (!settings) {
    return (
      <p className="text-sm text-muted-foreground">
        No AI usage yet. The settings row is created the first time someone imports a recipe.
      </p>
    );
  }

  const spentCents = rows.reduce((n, r) => n + Number(r.cost_cents), 0);
  const okCount = rows.filter((r) => r.outcome === "ok").length;
  const pctOfCap = Math.min(100, (spentCents / Math.max(settings.monthly_cost_cap_cents, 1)) * 100);

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold">Recipe import</h3>
            <p className="text-xs text-muted-foreground">
              {settings.enabled ? "On for everyone in the house" : "Switched off"}
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            disabled={saving}
            onCheckedChange={(v) => void patch({ enabled: v })}
            aria-label="Enable recipe import"
          />
        </div>
      </section>

      <section className="surface-card p-4">
        <h3 className="mb-3 font-bold">This month</h3>
        <div className="grid grid-cols-3 gap-3 text-center">
          <Figure label="Spent" value={money(spentCents)} />
          <Figure label="Imported" value={String(okCount)} />
          <Figure label="Calls" value={String(rows.length)} />
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-primary" style={{ width: `${pctOfCap}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {money(spentCents)} of {money(settings.monthly_cost_cap_cents)} — the feature stops when
          the ceiling is reached.
        </p>
      </section>

      <section className="surface-card p-4">
        <h3 className="mb-3 font-bold">Limits</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            id="ai-daily"
            label="Imports per person per day"
            value={settings.daily_calls_per_user}
            onCommit={(v) => void patch({ daily_calls_per_user: v })}
          />
          <NumberField
            id="ai-cap"
            label="Monthly ceiling (cents)"
            value={settings.monthly_cost_cap_cents}
            onCommit={(v) => void patch({ monthly_cost_cap_cents: v })}
          />
          <NumberField
            id="ai-in"
            label="Input price per 1M tokens ($)"
            value={settings.input_cost_per_mtok}
            step="0.01"
            onCommit={(v) => void patch({ input_cost_per_mtok: v })}
          />
          <NumberField
            id="ai-out"
            label="Output price per 1M tokens ($)"
            value={settings.output_cost_per_mtok}
            step="0.01"
            onCommit={(v) => void patch({ output_cost_per_mtok: v })}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Prices are only used to work out the running total. Correct them here if the provider
          changes them — no deploy needed.
        </p>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-2.5">
          <h3 className="text-sm font-bold">Recent calls</h3>
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => void load()}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">Nothing yet this month.</p>
        ) : (
          <ul>
            {rows.slice(0, 25).map((r) => (
              <li
                key={r.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2.5 last:border-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">
                    {names[r.user_id ?? ""] ?? "Someone"} • {r.outcome}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()} • {r.prompt_tokens}+
                    {r.completion_tokens} tokens
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-primary">
                  {money(Number(r.cost_cents))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-2 py-3">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/** Commits on blur rather than per keystroke, so a half-typed number never saves. */
function NumberField({
  id,
  label,
  value,
  step,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  step?: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step ?? "1"}
        min="0"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const next = Number(draft);
          if (Number.isFinite(next) && next >= 0 && next !== value) onCommit(next);
          else setDraft(String(value));
        }}
      />
    </div>
  );
}
