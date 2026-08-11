import { createFileRoute } from "@tanstack/react-router";
import { Check, Plus, RotateCcw, Share2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PageHeader, Screen } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildGroceryList, formatQty, shortDayLabel, toISODate, weekDates } from "@/lib/planning";
import { useStore } from "@/lib/store";
import { type Category, CATEGORIES } from "@/lib/types";
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

  const lines = useMemo(
    () => buildGroceryList(dates, state, recipesById),
    [dates.join(","), state, recipesById],
  );

  const [addOpen, setAddOpen] = useState(false);
  const toBuy = lines.filter((l) => l.needed > 0);
  const bought = toBuy.filter((l) => state.purchased[l.key]).length;

  const copyList = async () => {
    const text = CATEGORIES.map(({ id, label }) => {
      const items = toBuy.filter((l) => l.category === id);
      if (!items.length) return "";
      return `${label}\n${items.map((l) => `- ${l.name}: ${formatQty(l.needed, l.unit)}`).join("\n")}`;
    })
      .filter(Boolean)
      .join("\n\n");
    const cartText = state.cart.length
      ? `\n\nAdded from recipes\n${state.cart
          .map(
            (c) =>
              `- ${c.name}: ${formatQty(c.qty, c.unit)}${c.recipeTitle ? ` (for ${c.recipeTitle})` : ""}`,
          )
          .join("\n")}`
      : "";
    try {
      await navigator.clipboard.writeText(`${text}${cartText}`.trim() || "Nothing to buy");
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
            : `${shortDayLabel(dates[0]!)} – ${shortDayLabel(dates[dates.length - 1]!)}`
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
              range === r ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground",
            )}
          >
            {r === "today" ? "Today" : "Whole week"}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-primary-container px-4 py-3 text-primary-container-foreground">
        <p className="text-sm font-bold">
          {bought}/{toBuy.length} items picked up
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

      {toBuy.length === 0 ? (
        <p className="surface-card p-6 text-center text-sm text-muted-foreground">
          Nothing to buy — plan some dinners first, or your pantry already covers everything.
        </p>
      ) : (
        <div className="space-y-4">
          {CATEGORIES.map(({ id, label, emoji }) => {
            const items = toBuy.filter((l) => l.category === id);
            if (!items.length) return null;
            return (
              <section key={id} className="surface-card overflow-hidden">
                <h2 className="bg-surface-2 px-4 py-2.5 text-sm font-bold">
                  {emoji} {label}
                </h2>
                <ul>
                  {items.map((line) => {
                    const done = !!state.purchased[line.key];
                    return (
                      <li key={line.key} className="border-b border-border last:border-0">
                        <button
                          type="button"
                          onClick={() => store.togglePurchased(line.key)}
                          className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left"
                        >
                          <span
                            className={cn(
                              "grid h-6 w-6 shrink-0 place-items-center rounded-md border-2",
                              done ? "border-success bg-success text-success-foreground" : "border-border",
                            )}
                          >
                            {done ? <Check className="h-4 w-4" /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className={cn("block font-semibold", done && "line-through opacity-60")}>
                              {line.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {line.recipes.join(", ")}
                              {line.inStock > 0
                                ? ` • ${formatQty(line.inStock, line.unit)} in pantry`
                                : ""}
                            </span>
                          </span>
                          <span className="shrink-0 font-bold text-primary">
                            {formatQty(line.needed, line.unit)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <section className="surface-card mt-5 overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-surface-2 px-4 py-2.5">
            <h2 className="text-sm font-bold">
              🛒 Shopping cart{state.cart.length ? ` (${state.cart.length})` : ""}
            </h2>
            {state.cart.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => store.clearCart()}
              >
                Clear
              </Button>
            ) : null}
          </div>
          {state.cart.length > 0 ? (
            <ul>
              {state.cart.map((item) => (
                <li
                  key={item.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border px-4 py-3 last:border-0"
                >
                  <button
                    type="button"
                    aria-label={`Mark ${item.name} as bought`}
                    onClick={() => store.toggleCartItem(item.id)}
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-md border-2",
                      item.done ? "border-success bg-success text-success-foreground" : "border-border",
                    )}
                  >
                    {item.done ? <Check className="h-4 w-4" /> : null}
                  </button>
                  <span className="min-w-0">
                    <span className={cn("block font-semibold", item.done && "line-through opacity-60")}>
                      {item.name}
                    </span>
                    {item.recipeTitle ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        For {item.recipeTitle}
                      </span>
                    ) : (
                      <span className="block truncate text-xs text-muted-foreground">
                        {CATEGORIES.find((c) => c.id === item.category)?.emoji}{" "}
                        {CATEGORIES.find((c) => c.id === item.category)?.label}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-bold text-primary">
                    {formatQty(item.qty, item.unit)}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => store.removeCartItem(item.id)}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Your cart is empty. Add items you need to buy — from recipes or manually.
            </p>
          )}
          <div className="px-4 py-3">
            <AddItemDialog open={addOpen} onOpenChange={setAddOpen} onAdd={store.addToCart} />
          </div>
        </section>
    </Screen>

  );
}

function AddItemDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdd: (item: { name: string; qty: number; unit: string; category: Category; recipeTitle?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("kg");
  const [category, setCategory] = useState<Category>("vegetables");

  const reset = () => {
    setName("");
    setQty("");
    setUnit("kg");
    setCategory("vegetables");
  };

  const submit = () => {
    const qtyNum = Number(qty);
    if (!name.trim() || !qtyNum || qtyNum <= 0) {
      toast.error("Enter an item name and quantity");
      return;
    }
    onAdd({ name: name.trim(), qty: qtyNum, unit, category });
    toast.success(`${name.trim()} added to cart`);
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="w-full rounded-full" size="lg">
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
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger id="add-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["kg", "g", "L", "ml", "pcs", "pack", "bunch", "cup", "tbsp", "tsp"].map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
