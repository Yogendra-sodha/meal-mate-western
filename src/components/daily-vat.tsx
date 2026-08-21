import { Quote } from "lucide-react";
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { toISODate } from "@/lib/planning";

interface Vat {
  id: string;
  text: string;
  reference: string | null;
}

/**
 * Index for a given day. Derived from the date alone, so every roommate — and
 * every device — sees the same vat on the same day, and it advances at midnight
 * without any stored state.
 */
export function vatIndexForDate(iso: string, count: number): number {
  if (count <= 0) return 0;
  const days = Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
  return ((days % count) + count) % count;
}

export function DailyVat() {
  const [vat, setVat] = useState<Vat | null>(null);

  useEffect(() => {
    let active = true;
    void supabase
      .from("vato")
      .select("id, text, reference")
      .order("position")
      .then(({ data }) => {
        if (!active || !data?.length) return;
        setVat(data[vatIndexForDate(toISODate(new Date()), data.length)] ?? null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!vat) return null;

  return (
    <section className="surface-card mb-4 overflow-hidden">
      <div className="bg-surface-2 px-5 py-4">
        <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
          <Quote className="h-3.5 w-3.5" /> Swami ni Vat
        </p>
        <p className="mt-2 text-sm leading-relaxed text-foreground">{vat.text}</p>
        {vat.reference ? (
          <p className="mt-2 text-xs text-muted-foreground/70">{vat.reference}</p>
        ) : null}
      </div>
    </section>
  );
}
