import { createFileRoute } from "@tanstack/react-router";
import { Download, LogOut, Plus, Trash2, UploadCloud } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, Screen } from "@/components/app-shell";
import { EditedBy } from "@/components/edited-by";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { CATEGORIES, type Category } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pantry")({
  head: () => ({
    meta: [
      { title: "Pantry & Roommates — Bachelor Dinner Planner" },
      {
        name: "description",
        content:
          "Track pantry stock so it is removed from the grocery list automatically, manage the 10 roommates and export your data.",
      },
      { property: "og:title", content: "Pantry & Roommates" },
      {
        property: "og:description",
        content: "Inventory, recurring staples, roommates and data export in one place.",
      },
    ],
  }),
  component: Pantry,
});

function Pantry() {
  const store = useStore();
  const { state } = store;
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("kg");
  const [category, setCategory] = useState<Category>("pantry");
  const { household, members, user, signOut } = useAuth();
  const [importing, setImporting] = useState(false);

  const add = () => {
    if (!name.trim()) return;
    store.upsertInventory({
      id: `inv${Date.now()}`,
      name: name.trim(),
      qty: Number(qty) || 0,
      unit,
      category,
      recurring: false,
    });
    setName("");
    setQty("1");
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bachelor-dinner-planner.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Data exported");
  };

  return (
    <Screen>
      <PageHeader title="Pantry" subtitle="Anything in stock is deducted from the grocery list" />

      <section className="surface-card mb-4 p-4">
        <h2 className="font-bold">Add an item</h2>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_5rem_4.5rem] gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item" className="h-11" />
          <Input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
            placeholder="Qty"
            className="h-11"
          />
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg" className="h-11" />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-bold",
                category === c.id ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground",
              )}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
        <Button className="mt-3 h-11 w-full rounded-full" onClick={add}>
          <Plus className="mr-1 h-4 w-4" /> Add to pantry
        </Button>
      </section>

      {CATEGORIES.map(({ id, label, emoji }) => {
        const items = state.inventory.filter((i) => i.category === id);
        if (!items.length) return null;
        return (
          <section key={id} className="surface-card mb-3 overflow-hidden">
            <h2 className="bg-surface-2 px-4 py-2.5 text-sm font-bold">
              {emoji} {label}
            </h2>
            <ul>
              {items.map((item) => (
                <li
                  key={item.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-border px-4 py-2.5 last:border-0"
                >
                  <span className="min-w-0 truncate text-sm font-semibold">
                    {item.name}
                    {item.recurring ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">recurring</span>
                    ) : null}
                    <EditedBy userId={item.updatedBy} className="ml-2 font-normal" />
                  </span>
                  <Input
                    value={String(item.qty)}
                    inputMode="decimal"
                    onChange={(e) =>
                      store.upsertInventory({ ...item, qty: Number(e.target.value) || 0 })
                    }
                    className="h-9 w-20 text-right"
                  />
                  <span className="w-10 text-xs text-muted-foreground">{item.unit}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => store.removeInventory(item.id)}
                    className="col-start-3 row-start-1 hidden"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section className="surface-card mt-6 p-4">
        <h2 className="font-bold">{household?.name ?? "Household"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Share this invite code so roommates can join and see the same plan.
        </p>
        <button
          type="button"
          onClick={() => {
            if (!household) return;
            void navigator.clipboard.writeText(household.invite_code);
            toast.success("Invite code copied");
          }}
          className="mt-3 w-full rounded-2xl bg-surface-2 py-3 text-center text-2xl font-bold tracking-[0.3em]"
        >
          {household?.invite_code ?? "------"}
        </button>

        <h3 className="mt-5 font-bold">Roommates ({members.length})</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {members.map((m) => (
            <li
              key={m.user_id}
              className="rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold"
            >
              {m.name}
              {m.user_id === user?.id ? " (you)" : ""}
              {m.role === "owner" ? " ★" : ""}
            </li>
          ))}
        </ul>

        {store.hasLocalData ? (
          <Button
            variant="secondary"
            disabled={importing}
            className="mt-5 h-11 w-full rounded-full"
            onClick={async () => {
              setImporting(true);
              try {
                const count = await store.importLocalData();
                toast.success(`Imported ${count} item${count === 1 ? "" : "s"} into the household`);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Import failed");
              } finally {
                setImporting(false);
              }
            }}
          >
            <UploadCloud className="mr-2 h-4 w-4" /> Import my offline data
          </Button>
        ) : null}

        <Button
          variant="ghost"
          className="mt-2 h-11 w-full rounded-full text-muted-foreground"
          onClick={() => void signOut()}
        >
          <LogOut className="mr-2 h-4 w-4" /> Sign out
        </Button>
      </section>

      <Button variant="outline" className="mt-4 h-12 w-full rounded-full" onClick={exportData}>
        <Download className="mr-2 h-4 w-4" /> Export all data (JSON)
      </Button>
    </Screen>
  );
}
