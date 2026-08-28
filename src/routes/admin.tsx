import { createFileRoute } from "@tanstack/react-router";
import {
  Home,
  Pencil,
  Quote,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserMinus,
  Users,
  Utensils,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AiUsagePanel } from "@/components/ai-usage-panel";
import { PageHeader, Screen } from "@/components/app-shell";
import { vatIndexForDate } from "@/components/daily-vat";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toISODate } from "@/lib/planning";

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

interface Vat {
  id: string;
  text: string;
  reference: string | null;
  position: number;
}

function Admin() {
  const { isAdmin, loading } = useAuth();
  const [tab, setTab] = useState<"households" | "vato" | "ai">("households");

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

  return (
    <Screen>
      <PageHeader title="Admin" subtitle="Everything on this deployment" />
      <div className="mb-4 flex gap-2">
        <TabChip active={tab === "households"} onClick={() => setTab("households")}>
          Households
        </TabChip>
        <TabChip active={tab === "vato"} onClick={() => setTab("vato")}>
          Daily vato
        </TabChip>
        <TabChip active={tab === "ai"} onClick={() => setTab("ai")}>
          AI usage
        </TabChip>
      </div>
      {tab === "households" ? <Households /> : null}
      {tab === "vato" ? <VatoManager /> : null}
      {tab === "ai" ? <AiUsagePanel /> : null}
    </Screen>
  );
}

function TabChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          : "rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-muted-foreground"
      }
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ households */

function Households() {
  const [households, setHouseholds] = useState<AdminHousehold[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AdminHousehold | null>(null);
  const [deleting, setDeleting] = useState<AdminHousehold | null>(null);

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
    void load();
  }, [load]);

  const removeMember = async (h: AdminHousehold, m: AdminMember) => {
    if (!window.confirm(`Remove ${m.name} from ${h.name}? Their account is not deleted.`)) return;
    const { error: e } = await supabase
      .from("household_members")
      .delete()
      .eq("household_id", h.id)
      .eq("user_id", m.user_id);
    if (e) toast.error(e.message);
    else {
      toast.success(`${m.name} removed`);
      void load();
    }
  };

  const totalMembers = (households ?? []).reduce((sum, h) => sum + h.members.length, 0);

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="rounded-full"
          onClick={() => void load()}
          disabled={busy}
        >
          <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

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
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{m.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{m.email}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {m.role}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    onClick={() => void removeMember(h, m)}
                    className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:text-destructive"
                  >
                    <UserMinus className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => setEditing(h)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-destructive"
                onClick={() => setDeleting(h)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {editing ? (
        <EditHouseholdDialog
          household={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteHouseholdDialog
          household={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

function EditHouseholdDialog({
  household,
  onClose,
  onSaved,
}: {
  household: AdminHousehold;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(household.name);
  const [servings, setServings] = useState(String(household.default_servings));
  const [code, setCode] = useState(household.invite_code);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Give the household a name");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("households")
      .update({
        name: name.trim(),
        default_servings: Number(servings) || 20,
        invite_code: code.trim().toUpperCase(),
      })
      .eq("id", household.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Household updated");
      onSaved();
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Edit household</DialogTitle>
          <DialogDescription>Changes apply for everyone in this household.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="ah-name">Name</Label>
            <Input id="ah-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ah-servings">Default plates</Label>
            <Input
              id="ah-servings"
              inputMode="numeric"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ah-code">Invite code</Label>
            <Input
              id="ah-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="uppercase tracking-wider"
            />
            <p className="text-xs text-muted-foreground">
              Changing this stops the old code working for new joins.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteHouseholdDialog({
  household,
  onClose,
  onDeleted,
}: {
  household: AdminHousehold;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const armed = confirm.trim().toLowerCase() === household.name.trim().toLowerCase();

  const remove = async () => {
    setBusy(true);
    const { error } = await supabase.from("households").delete().eq("id", household.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`${household.name} deleted`);
      onDeleted();
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Delete {household.name}?</DialogTitle>
          <DialogDescription>
            This permanently removes {household.recipe_count} recipes, {household.meal_plan_count}{" "}
            planned days, {household.grocery_count} grocery items, {household.pantry_count} pantry
            items and {household.members.length} membership
            {household.members.length === 1 ? "" : "s"}. Member accounts themselves are not deleted.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="ah-confirm">
            Type <span className="font-bold">{household.name}</span> to confirm
          </Label>
          <Input
            id="ah-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!armed || busy}
            onClick={() => void remove()}
          >
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ vato */

/**
 * Parses pasted Swami ni Vato. Each blank-line-separated block is one vat; if
 * its last line looks like a citation it becomes the reference.
 */
export function parseVatoPaste(raw: string): { text: string; reference: string }[] {
  return raw
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      const last = lines[lines.length - 1] ?? "";
      // A citation is short and contains bracketed numbers, e.g. "Glory of God (37.1) / (1/1)"
      const isCitation = lines.length > 1 && last.length <= 80 && /\(\d+[./]\d+\)/.test(last);
      return isCitation
        ? { text: lines.slice(0, -1).join(" "), reference: last }
        : { text: lines.join(" "), reference: "" };
    })
    .filter((v) => v.text.length > 0);
}

function VatoManager() {
  const [vato, setVato] = useState<Vat[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Vat | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const { data, error } = await supabase
      .from("vato")
      .select("id, text, reference, position")
      .order("position");
    setBusy(false);
    if (error) toast.error(error.message);
    else setVato(data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const list = vato ?? [];

  const todayIndex = useMemo(
    () => (list.length ? vatIndexForDate(toISODate(new Date()), list.length) : -1),
    [list.length],
  );

  const remove = async (v: Vat) => {
    if (!window.confirm("Delete this vat?")) return;
    const { error } = await supabase.from("vato").delete().eq("id", v.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Deleted");
      void load();
    }
  };

  return (
    <>
      <div className="surface-card mb-4 p-4">
        <p className="inline-flex items-center gap-1.5 text-sm font-bold">
          <Quote className="h-4 w-4 text-primary" /> {list.length} vato loaded
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          One shows on the home page each day, the same one for everyone, advancing at midnight.
          With {list.length || "0"} loaded the cycle repeats every {list.length || 0} day
          {list.length === 1 ? "" : "s"}.
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" className="rounded-full" onClick={() => setImportOpen(true)}>
            Import vato
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => void load()}
            disabled={busy}
          >
            <RefreshCw className={busy ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </div>

      <ul className="space-y-2">
        {list.map((v, i) => (
          <li key={v.id} className="surface-card p-4">
            {i === todayIndex ? (
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-primary">Today</p>
            ) : null}
            <p className="text-sm leading-relaxed">{v.text}</p>
            {v.reference ? (
              <p className="mt-1 text-xs text-muted-foreground/70">{v.reference}</p>
            ) : null}
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => setEditing(v)}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full text-destructive"
                onClick={() => void remove(v)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {importOpen ? (
        <ImportVatoDialog
          existing={list.length}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false);
            void load();
          }}
        />
      ) : null}

      {editing ? (
        <EditVatDialog
          vat={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

function ImportVatoDialog({
  existing,
  onClose,
  onDone,
}: {
  existing: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseVatoPaste(raw), [raw]);

  const save = async () => {
    if (!parsed.length) {
      toast.error("Nothing to import");
      return;
    }
    setBusy(true);
    // Duplicate references are skipped by the unique index, so re-importing an
    // overlapping batch is safe.
    const { error, count } = await supabase
      .from("vato")
      .upsert(
        parsed.map((v, i) => ({
          text: v.text,
          // NULL rather than "" so vato without a citation do not collide on
          // the unique reference index.
          reference: v.reference || null,
          position: existing + i + 1,
        })),
        { onConflict: "reference", ignoreDuplicates: true, count: "exact" },
      );
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`Imported ${count ?? parsed.length} vato`);
      onDone();
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>Import vato</DialogTitle>
          <DialogDescription>
            Paste the English text. Separate each vat with a blank line. If the last line of a block
            looks like a citation — for example "Glory of God (37.1) / (1/1)" — it is stored as the
            reference. Re-importing the same text is safe; duplicates are skipped.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={12}
          placeholder={"First vat text…\nGlory of God (37.1) / (1/1)\n\nSecond vat text…\nReference (2.4) / (1/2)"}
        />
        <p className="text-xs text-muted-foreground">
          {parsed.length} vat{parsed.length === 1 ? "" : "o"} detected
          {parsed.filter((p) => p.reference).length
            ? `, ${parsed.filter((p) => p.reference).length} with a reference`
            : ""}
          .
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !parsed.length}>
            Import {parsed.length || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditVatDialog({
  vat,
  onClose,
  onSaved,
}: {
  vat: Vat;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState(vat.text);
  const [reference, setReference] = useState(vat.reference ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!text.trim()) {
      toast.error("Text cannot be empty");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("vato")
      .update({ text: text.trim(), reference: reference.trim() || null })
      .eq("id", vat.id);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Updated");
      onSaved();
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto rounded-3xl">
        <DialogHeader>
          <DialogTitle>Edit vat</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-1.5">
            <Label htmlFor="v-text">Text</Label>
            <Textarea
              id="v-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-ref">Reference</Label>
            <Input id="v-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
