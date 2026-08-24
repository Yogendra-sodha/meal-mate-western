import { createFileRoute } from "@tanstack/react-router";
import { Check, ChevronDown, Plus, RotateCcw, Share2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader, Screen } from "@/components/app-shell";
import { EditedBy } from "@/components/edited-by";
import { PastShops } from "@/components/past-shops";
import { SwipeToDelete } from "@/components/swipe-to-delete";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildGroceryList,
  formatQty,
  shortDayLabel,
  toISODate,
  weekDates,
  weekRangeLabel,
} from "@/lib/planning";
import { useStore } from "@/lib/store";
import { type AppState, type Category, CATEGORIES } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/grocery")({
  validateSearch: (search: Record<string, unknown>) => ({
    week: Number(search["week"] ?? 0) || 0,
  }),
  head: () => ({
    meta: [
      { title: "Grocery List — Bachelor Dinner Planner" },
      {
        name: "description",
        content:
          "Auto-generated grocery list with merged quantities by vegetables, dairy, grains, spices and pantry for the whole week.",
      },
      { property: "og:title", content: "Grocery List" },
      {
        property: "og:description",
        content: "Exactly what to buy and how much, already adjusted for what's in the pantry.",
      },
    ],
  }),
  component: Grocery,
});

function Grocery() {
  const { week } = Route.useSearch();
  const store = useStore();
  const { state, recipesById } = store;
  const [range, setRange] = useState<"today" | "week">("week");

  const anchor = new Date();
  anchor.setDate(anchor.getDate() + week * 7);
  const dates = range === "today" ? [toISODate(new Date())] : weekDates(anchor).map(toISODate);

  // Every dish planned this week, whatever the today/week toggle shows — an
  // item added on Monday may well be for Saturday's dish.
  const weekDishes = useMemo(() => {
    const titles = new Set<string>();
    for (const iso of weekDates(anchor).map(toISODate)) {
      for (const id of state.plan[iso]?.recipeIds ?? []) {
        const title = recipesById[id]?.title;
        if (title) titles.add(title);
      }
    }
    return [...titles].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, state.plan, recipesById]);

  const weekStart = toISODate(weekDates(anchor)[0]!);

  /**
   * Shops already done for this week. Their items are matched by name alone,
   * not name+unit, so an amount edited to different units before shopping
   * still counts as bought.
   */
  const handledThisWeek = useMemo(() => {
    const names = new Set<string>();
    for (const trip of state.trips) {
      if (trip.coversWeek !== weekStart) continue;
      for (const item of trip.items) names.add(item.name.toLowerCase());
      // Skipped lines were removed on purpose; finishing the shop clears the
      // dismissal flags, so the trip is what keeps them off this week.
      for (const name of trip.skipped) names.add(name.toLowerCase());
    }
    return names;
  }, [state.trips, weekStart]);

  const shoppedTrip = useMemo(
    () => state.trips.find((t) => t.coversWeek === weekStart) ?? null,
    [state.trips, weekStart],
  );

  const lines = useMemo(
    () => buildGroceryList(dates, state, recipesById),
    [dates.join(","), state, recipesById],
  );

  /**
   * One row shape for both kinds of item, so the list renders and behaves
   * identically whether a line came from the meal plan or was added by hand.
   * Planned lines are derived, so removing one flags it as dismissed rather
   * than deleting a row.
   */
  type Row = {
    id: string;
    name: string;
    qty: number;
    unit: string;
    category: Category;
    note: string;
    done: boolean;
    updatedBy?: string | undefined;
    /** true when a manual amount is pinned over the computed one */
    edited?: boolean;
    /** what the meal plan works out to, for the "back to computed" action */
    computed?: { qty: number; unit: string };
    toggle: () => void;
    source: "planned" | "added";
    key?: string;
    item?: (typeof state.cart)[number];
  };

  const rows: Row[] = useMemo(() => {
    const planned: Row[] = lines
      .filter(
        (l) =>
          l.needed > 0 && !state.dismissed[l.key] && !handledThisWeek.has(l.name.toLowerCase()),
      )
      .map((l) => {
        const override = state.overrides[l.key];
        return {
          id: `planned:${l.key}`,
          name: l.name,
          qty: override ? override.qty : l.needed,
          unit: override ? override.unit : l.unit,
          edited: !!override,
          computed: { qty: l.needed, unit: l.unit },
          category: l.category,
          note:
            l.recipes.join(", ") +
            (l.inStock > 0 ? ` • ${formatQty(l.inStock, l.unit)} in pantry` : ""),
          done: !!state.purchased[l.key],
          toggle: () => store.togglePurchased(l.key),
          source: "planned" as const,
          key: l.key,
        };
      });

    const added: Row[] = state.cart.map((item) => ({
      id: `added:${item.id}`,
      name: item.name,
      qty: item.qty,
      unit: item.unit,
      edited: false,
      category: item.category,
      note: item.recipeTitle ? `For ${item.recipeTitle}` : "Other",
      done: item.done,
      updatedBy: item.updatedBy,
      toggle: () => store.toggleCartItem(item.id),
      source: "added",
      item,
    }));

    return [...planned, ...added].sort((a, b) => a.name.localeCompare(b.name));
  }, [
    lines,
    state.dismissed,
    state.purchased,
    state.overrides,
    state.cart,
    handledThisWeek,
    store,
  ]);

  // Removal is easy to trigger by accident, so both kinds offer a way back.
  const removeRow = (row: Row) => {
    if (row.source === "planned" && row.key) {
      const key = row.key;
      store.dismissLine(key);
      toast(`Removed ${row.name}`, {
        action: { label: "Undo", onClick: () => store.restoreLine(key) },
      });
      return;
    }
    const item = row.item;
    if (!item) return;
    store.removeCartItem(item.id);
    toast(`Removed ${item.name}`, {
      action: {
        label: "Undo",
        // Re-adding creates a fresh row, so the tick state is not restored.
        onClick: () =>
          store.addToCart({
            name: item.name,
            qty: item.qty,
            unit: item.unit,
            category: item.category,
            ...(item.recipeTitle !== undefined ? { recipeTitle: item.recipeTitle } : {}),
          }),
      },
    });
  };

  const [addOpen, setAddOpen] = useState(false);
  // Category the Add dialog opens on, set by whichever "+" was tapped.
  const [addCategory, setAddCategory] = useState<Category>("vegetables");
  const [editing, setEditing] = useState<Row | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [store_, setStore] = useState("");
  const [total, setTotal] = useState("");
  const bought = rows.filter((r) => r.done).length;
  const allDone = rows.length > 0 && bought === rows.length;

  // Ask once when the list first becomes complete. Re-arms only after the list
  // is incomplete again, so unticking and reticking one item does not nag.
  const asked = useRef(false);
  useEffect(() => {
    if (!allDone) {
      asked.current = false;
      return;
    }
    if (asked.current) return;
    asked.current = true;
    setFinishOpen(true);
  }, [allDone]);

  const finishShopping = async () => {
    setFinishing(true);
    await store.finishShopping(
      rows.map((r) => ({ name: r.name, qty: r.qty, unit: r.unit, category: r.category })),
      weekStart,
      // Lines removed from this week's list: not bought, but not wanted back.
      lines.filter((l) => state.dismissed[l.key]).map((l) => l.name),
      {
        store: store_.trim() || undefined,
        total: Number(total) > 0 ? Number(total) : undefined,
      },
    );
    setFinishing(false);
    setFinishOpen(false);
    setStore("");
    setTotal("");
    toast.success("Shop saved — the list is ready for next time");
  };

  const saveAmount = (row: Row, qty: number, unit: string) => {
    if (row.source === "planned" && row.key) store.setLineOverride(row.key, qty, unit);
    else if (row.item) store.updateCartItem(row.item.id, { qty, unit });
  };

  const copyList = async () => {
    const text = CATEGORIES.map(({ id, label }) => {
      const items = rows.filter((r) => r.category === id);
      if (!items.length) return "";
      return `${label}\n${items.map((r) => `- ${r.name}: ${formatQty(r.qty, r.unit)}`).join("\n")}`;
    })
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text.trim() || "Nothing to buy");
      toast.success("Grocery list copied");
    } catch {
      toast.error("Could not copy the list");
    }
  };

  return (
    <Screen>
      <PageHeader
        title="Grocery list"
        subtitle={
          range === "today"
            ? "For tonight's dinner"
            : weekRangeLabel(dates[0]!, dates[dates.length - 1]!)
        }
        action={
          <Button
            variant="secondary"
            size="icon"
            className="h-11 w-11 rounded-full"
            onClick={copyList}
            aria-label="Copy list"
          >
            <Share2 className="h-5 w-5" />
          </Button>
        }
      />

      <div className="mb-4 flex gap-2">
        {(["today", "week"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRange(r)}
            className={cn(
              "flex-1 rounded-full px-4 py-2.5 text-sm font-bold",
              range === r
                ? "bg-primary text-primary-foreground"
                : "bg-surface-2 text-muted-foreground",
            )}
          >
            {r === "today" ? "Today" : "Whole week"}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-primary-container px-4 py-3 text-primary-container-foreground">
        <p className="text-sm font-bold">
          {bought}/{rows.length} items picked up
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={() => store.clearPurchased()}
        >
          <RotateCcw className="mr-1 h-4 w-4" /> Reset
        </Button>
      </div>

      {shoppedTrip ? (
        <div className="surface-card mb-4 flex items-center justify-between gap-3 p-4">
          <p className="min-w-0 text-sm">
            <span className="font-bold">Shopped for this week</span>
            <span className="block text-xs text-muted-foreground">
              {shoppedTrip.items.length} items on{" "}
              {new Date(shoppedTrip.doneOn + "T00:00:00").toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              })}
              . Anything added to the plan since shows below.
            </span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 rounded-full"
            onClick={() => {
              if (
                !window.confirm(
                  "Bring this week's list back? Items you added by hand were cleared when the shop was saved and will not return.",
                )
              )
                return;
              void store.undoShopping(shoppedTrip.id);
            }}
          >
            Undo
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="surface-card p-6 text-center text-sm text-muted-foreground">
          {shoppedTrip
            ? "Everything for this week is bought."
            : "Nothing to buy — plan some dinners first, or add an item below."}
        </p>
      ) : (
        <div className="space-y-4">
          {CATEGORIES.map(({ id, label, emoji }) => {
            const items = rows.filter((r) => r.category === id);
            if (!items.length) return null;
            return (
              <section key={id} className="surface-card overflow-hidden">
                <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-2.5">
                  <h2 className="text-sm font-bold">
                    {emoji} {label}
                  </h2>
                  <button
                    type="button"
                    aria-label={`Add an item to ${label}`}
                    onClick={() => {
                      setAddCategory(id);
                      setAddOpen(true);
                    }}
                    className="grid h-7 w-7 place-items-center rounded-full bg-background text-primary"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <ul>
                  {items.map((row) => (
                    <li key={row.id} className="border-b border-border last:border-0">
                      <SwipeToDelete onDelete={() => removeRow(row)}>
                        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 bg-background px-4 py-3">
                          <button
                            type="button"
                            aria-label={`Mark ${row.name} as bought`}
                            onClick={row.toggle}
                            className={cn(
                              "grid h-6 w-6 shrink-0 place-items-center rounded-md border-2",
                              row.done
                                ? "border-success bg-success text-success-foreground"
                                : "border-border",
                            )}
                          >
                            {row.done ? <Check className="h-4 w-4" /> : null}
                          </button>
                          <span className="min-w-0">
                            <span
                              className={cn(
                                "block font-semibold",
                                row.done && "line-through opacity-60",
                              )}
                            >
                              {row.name}
                            </span>
                            {row.note ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {row.note}
                              </span>
                            ) : null}
                            <EditedBy userId={row.updatedBy} className="block truncate" />
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditing(row)}
                            aria-label={`Edit amount for ${row.name}`}
                            className={cn(
                              "shrink-0 rounded-full px-2 py-1 font-bold text-primary",
                              row.edited && "underline decoration-dotted underline-offset-4",
                            )}
                          >
                            {formatQty(row.qty, row.unit)}
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${row.name}`}
                            onClick={() => removeRow(row)}
                            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </SwipeToDelete>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        <AddItemDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          onAdd={store.addToCart}
          defaultCategory={addCategory}
          onOpenDefault={() => setAddCategory("vegetables")}
          dishes={weekDishes}
        />
      </div>

      <PastShops
        trips={state.trips}
        className="mt-5"
        onlyWeek={weekStart}
        title="Shops for this week"
      />

      <Dialog open={finishOpen} onOpenChange={setFinishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Shopping done?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              All {rows.length} items are ticked off. Saving files them under past shops and takes
              them off this week's list. Anything added to the plan afterwards still shows up, and
              next week starts clean.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="finish-store">Store (optional)</Label>
                <Input
                  id="finish-store"
                  list="store-suggestions"
                  value={store_}
                  onChange={(e) => setStore(e.target.value)}
                  placeholder="Patel Grocery"
                />
                <datalist id="store-suggestions">
                  {STORE_SUGGESTIONS.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="finish-total">Bill total (optional)</Label>
                <Input
                  id="finish-total"
                  type="number"
                  inputMode="decimal"
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                size="lg"
                onClick={() => void finishShopping()}
                disabled={finishing}
              >
                Yes, save it
              </Button>
              <Button variant="outline" size="lg" onClick={() => setFinishOpen(false)}>
                Not yet
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {editing ? (
        <EditAmountDialog
          row={editing}
          onClose={() => setEditing(null)}
          onSave={(qty, unit) => saveAmount(editing, qty, unit)}
          {...(editing.source === "planned" && editing.key
            ? { onResetToComputed: () => store.clearLineOverride(editing.key!) }
            : {})}
        />
      ) : null}
    </Screen>
  );
}

/** Stands in for "not tied to a dish"; Radix Select rejects an empty value. */
const NO_DISH = "__none__";

/** Offered when saving a shop; the field stays free text for anywhere else. */
const STORE_SUGGESTIONS = [
  "Patel Grocery",
  "JFK Grocery",
  "Stop and Shop",
  "ShopRite",
  "Walmart",
  "Costco",
  "Instacart",
];

/** Suggested units; the field stays free text so anything else can be typed. */
const UNIT_SUGGESTIONS = [
  "kg",
  "g",
  "lbs",
  "oz",
  "L",
  "ml",
  "pcs",
  "pieces",
  "pack",
  "bunch",
  "cup",
  "tbsp",
  "tsp",
];

function EditAmountDialog({
  row,
  onClose,
  onSave,
  onResetToComputed,
}: {
  row: {
    name: string;
    qty: number;
    unit: string;
    edited?: boolean;
    computed?: { qty: number; unit: string };
  };
  onClose: () => void;
  onSave: (qty: number, unit: string) => void;
  onResetToComputed?: (() => void) | undefined;
}) {
  const [qty, setQty] = useState(String(row.qty));
  const [unit, setUnit] = useState(row.unit);

  const save = () => {
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter an amount greater than zero");
      return;
    }
    if (!unit.trim()) {
      toast.error("Enter a unit");
      return;
    }
    onSave(n, unit.trim());
    onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-qty">Amount</Label>
              <Input
                id="edit-qty"
                type="number"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-unit">Unit</Label>
              <Input
                id="edit-unit"
                list="unit-suggestions"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="kg"
              />
              <datalist id="unit-suggestions">
                {UNIT_SUGGESTIONS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
          </div>

          {row.computed ? (
            <p className="text-xs text-muted-foreground">
              The plan works out to {formatQty(row.computed.qty, row.computed.unit)}. Setting your
              own amount pins it, so it stops changing when the plan or servings change.
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button className="flex-1" size="lg" onClick={save}>
              Save
            </Button>
            {row.edited && onResetToComputed ? (
              <Button
                variant="outline"
                size="lg"
                onClick={() => {
                  onResetToComputed();
                  onClose();
                }}
              >
                Use plan amount
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddItemDialog({
  open,
  onOpenChange,
  onAdd,
  defaultCategory = "vegetables",
  onOpenDefault,
  dishes = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (item: {
    name: string;
    qty: number;
    unit: string;
    category: Category;
    recipeTitle?: string;
  }) => void;
  /** category to preselect, set by whichever section's "+" opened this */
  defaultCategory?: Category;
  /** resets the caller's category when opened from the list-wide button */
  onOpenDefault?: (() => void) | undefined;
  /** dishes planned this week, offered to tag the item against */
  dishes?: string[];
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("kg");
  const [category, setCategory] = useState<Category>(defaultCategory);
  // Radix Select cannot carry an empty value, so "not tied to a dish" needs a
  // sentinel rather than "".
  const [dish, setDish] = useState(NO_DISH);

  // Follow the section that opened the dialog, but leave the field free to
  // change once it is open.
  useEffect(() => {
    if (open) setCategory(defaultCategory);
  }, [open, defaultCategory]);

  const reset = () => {
    setName("");
    setQty("");
    setUnit("kg");
    setCategory(defaultCategory);
    setDish(NO_DISH);
  };

  const submit = () => {
    const qtyNum = Number(qty);
    if (!name.trim() || !qtyNum || qtyNum <= 0) {
      toast.error("Enter an item name and quantity");
      return;
    }
    onAdd({
      name: name.trim(),
      qty: qtyNum,
      unit,
      category,
      ...(dish !== NO_DISH ? { recipeTitle: dish } : {}),
    });
    toast.success(`${name.trim()} added to cart`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="w-full rounded-full" size="lg" onClick={() => onOpenDefault?.()}>
          <Plus className="mr-1.5 h-5 w-5" /> Add item to cart
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add item to cart</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="add-name">Item name</Label>
            <Input
              id="add-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Tomatoes, Paneer, Bread"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="add-qty">Quantity</Label>
              <Input
                id="add-qty"
                type="number"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="2"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-unit">Unit</Label>
              <Input
                id="add-unit"
                list="unit-suggestions"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="kg"
              />
              <datalist id="unit-suggestions">
                {UNIT_SUGGESTIONS.map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>For which dish?</Label>
            <Select value={dish} onValueChange={setDish}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DISH}>Other — not for a dish</SelectItem>
                {dishes.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {dishes.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No dishes planned this week yet — the item will be filed under Other.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as Category)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.emoji} {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" size="lg" onClick={submit}>
            Add to cart
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
