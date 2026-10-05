import { Link2, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { splitwiseGroups, type SplitwiseRefusal } from "@/lib/splitwise/functions";
import { cn } from "@/lib/utils";

const MESSAGES: Record<SplitwiseRefusal, string> = {
  not_configured: "No Splitwise token is set. Add SPLITWISE_API_KEY in Vercel and redeploy.",
  no_group: "Pick which Splitwise group the house is.",
  disabled: "Sending to Splitwise is switched off.",
  nobody_mapped: "Nobody in the split is matched to a Splitwise person yet.",
  no_total: "That shop has no bill total, so there is nothing to split.",
  already_sent: "That shop has already gone to Splitwise.",
  shares_wrong: "The shares did not add up — the payer has to be one of the people splitting it.",
  busy: "Splitwise is rate-limiting or down. Try again in a minute.",
  splitwise_error: "Splitwise turned the request down.",
};

interface Group {
  id: number;
  name: string;
  members: { id: number; name: string }[];
}

/**
 * Connects the house to a Splitwise group and says who is who.
 *
 * The groups are fetched rather than typed: it proves the token works before
 * anything is sent, and nobody has to go hunting for a group id. Mapping is
 * admin-only — getting it wrong puts someone else's name on a bill.
 */
export function SplitwisePanel() {
  const { household, members } = useAuth();
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [me, setMe] = useState<{ id: number; name: string } | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mapping, setMapping] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!household) return;
    const [{ data: settings }, { data: mapped }] = await Promise.all([
      supabase.from("splitwise_settings").select("group_id, enabled").limit(1).maybeSingle(),
      supabase.from("splitwise_members").select("user_id, splitwise_user_id"),
    ]);
    setGroupId(settings?.group_id ? Number(settings.group_id) : null);
    setEnabled(Boolean(settings?.enabled));
    setMapping(
      Object.fromEntries((mapped ?? []).map((m) => [m.user_id, Number(m.splitwise_user_id)])),
    );
    setLoading(false);
  }, [household]);

  useEffect(() => {
    void load();
  }, [load]);

  const check = async () => {
    setChecking(true);
    try {
      const result = await splitwiseGroups();
      if (!result.ok) {
        toast.error(
          result.detail
            ? `${MESSAGES[result.refusal]} (${result.detail})`
            : MESSAGES[result.refusal],
          { duration: 8000 },
        );
        return;
      }
      setMe(result.me);
      setGroups(result.groups);
      toast.success(`Connected as ${result.me.name} — ${result.groups.length} groups`);
    } finally {
      setChecking(false);
    }
  };

  const saveSettings = async (patch: { group_id?: number | null; enabled?: boolean }) => {
    if (!household) return;
    const { error } = await supabase.from("splitwise_settings").upsert(
      {
        household_id: household.id,
        group_id: patch.group_id !== undefined ? patch.group_id : groupId,
        enabled: patch.enabled !== undefined ? patch.enabled : enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id" },
    );
    if (error) {
      toast.error("Could not save that");
      return;
    }
    if (patch.group_id !== undefined) setGroupId(patch.group_id);
    if (patch.enabled !== undefined) setEnabled(patch.enabled);
  };

  const mapMember = async (userId: string, splitwiseUserId: number | null) => {
    if (!household) return;
    if (splitwiseUserId === null) {
      await supabase.from("splitwise_members").delete().eq("user_id", userId);
      setMapping((m) => {
        const next = { ...m };
        delete next[userId];
        return next;
      });
      return;
    }
    const { error } = await supabase
      .from("splitwise_members")
      .upsert(
        { household_id: household.id, user_id: userId, splitwise_user_id: splitwiseUserId },
        { onConflict: "household_id,user_id" },
      );
    if (error) {
      toast.error("Could not save that match");
      return;
    }
    setMapping((m) => ({ ...m, [userId]: splitwiseUserId }));
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading Splitwise…</p>;

  const chosen = groups.find((g) => g.id === groupId);
  const mappedCount = Object.keys(mapping).length;

  return (
    <section className="surface-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-bold">
            <Link2 className="h-4 w-4" /> Splitwise
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Send a finished shop over as one expense, split between whoever was in on it.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => void saveSettings({ enabled: v })}
          disabled={!groupId || mappedCount === 0}
          aria-label="Send shops to Splitwise"
        />
      </div>

      <Button
        variant="secondary"
        className="mt-3 h-11 w-full rounded-full"
        disabled={checking}
        onClick={() => void check()}
      >
        {checking ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        {me ? `Connected as ${me.name} — refresh` : "Check the connection"}
      </Button>

      {groups.length ? (
        <div className="mt-4">
          <Label className="text-sm font-bold">Which group is the house?</Label>
          <div className="mt-2 grid gap-1.5">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => void saveSettings({ group_id: g.id })}
                className={cn(
                  "rounded-2xl px-3 py-2.5 text-left text-sm font-semibold",
                  groupId === g.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-surface-2 text-foreground",
                )}
              >
                {g.name}
                <span
                  className={cn(
                    "ml-2 text-xs font-normal",
                    groupId === g.id ? "text-primary-foreground/80" : "text-muted-foreground",
                  )}
                >
                  {g.members.length} people
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {chosen ? (
        <div className="mt-4">
          <Label className="text-sm font-bold">Who is who</Label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Anyone left unmatched is simply left out of a split rather than breaking it.
          </p>
          <div className="mt-2 grid gap-2">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-semibold">{m.name}</span>
                <select
                  className="h-10 min-w-0 flex-1 rounded-full bg-surface-2 px-3 text-sm"
                  value={mapping[m.user_id] ?? ""}
                  onChange={(e) =>
                    void mapMember(m.user_id, e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">Not on Splitwise</option>
                  {chosen.members.map((sm) => (
                    <option key={sm.id} value={sm.id}>
                      {sm.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : groupId ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Group saved. Check the connection to load its members and match them up.
        </p>
      ) : null}

      {!enabled && groupId && mappedCount > 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Ready — switch it on above and a Send to Splitwise button appears on each finished shop.
        </p>
      ) : null}
    </section>
  );
}
