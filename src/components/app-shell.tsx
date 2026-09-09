import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, ChefHat, Home, ShoppingCart, Package } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Today", icon: Home },
  { to: "/planner", label: "Week", icon: CalendarDays },
  { to: "/grocery", label: "Grocery", icon: ShoppingCart },
  { to: "/recipes", label: "Recipes", icon: ChefHat },
  { to: "/pantry", label: "Pantry", icon: Package },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    // Opaque, and deliberately not blurred. Safari gives a fixed element with
    // a backdrop-filter its own compositing layer and then fails to keep that
    // layer pinned while the toolbars slide away, so the bar detaches and
    // hangs halfway up the screen mid-scroll. A solid background needs no such
    // layer and stays where it is put.
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          return (
            <li key={to}>
              <Link
                to={to}
                className="flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-semibold"
              >
                <span
                  className={cn(
                    "grid h-8 w-16 place-items-center rounded-full transition-colors",
                    active
                      ? "bg-primary-container text-primary-container-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <span className={cn(active ? "text-foreground" : "text-muted-foreground")}>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 pt-6 pb-4">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold">{title}</h1>
        {subtitle ? (
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

export function Screen({ children }: { children: ReactNode }) {
  // dvh rather than vh: on iOS, 100vh is the viewport with the toolbars
  // hidden, so the page is taller than what is actually visible and the layout
  // shifts under the bar every time they appear.
  return <div className="mx-auto min-h-dvh w-full max-w-lg page-pad">{children}</div>;
}
