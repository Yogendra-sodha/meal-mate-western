/**
 * Supabase sends the user back from an email link with the outcome encoded in
 * the URL. On the implicit flow (this client's default) that is a hash
 * fragment: `#access_token=...&type=signup`, or `#error=...&error_description=...`.
 *
 * supabase-js clears that fragment as soon as the client initialises, so the
 * snapshot is taken at module load — before any `supabase.*` access can create
 * the client — and the result is frozen for the rest of the page's life.
 */

export type AuthRedirect =
  | { kind: "confirmed"; type: string }
  | { kind: "error"; message: string }
  | null;

const CONFIRM_TYPES = new Set(["signup", "email_change", "invite", "magiclink"]);

function humanise(raw: string): string {
  const text = decodeURIComponent(raw.replace(/\+/g, " ")).trim();
  if (/expired/i.test(text)) {
    return "That confirmation link has expired. Sign up again to get a fresh one.";
  }
  if (/already/i.test(text)) return "That link has already been used — try signing in.";
  return text || "The confirmation link could not be used.";
}

function read(): AuthRedirect {
  if (typeof window === "undefined") return null;

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const get = (key: string) => hash.get(key) ?? query.get(key);

  const error = get("error_description") ?? get("error");
  if (error) return { kind: "error", message: humanise(error) };

  const type = get("type");
  if (type && CONFIRM_TYPES.has(type)) return { kind: "confirmed", type };

  return null;
}

export const authRedirect: AuthRedirect = read();
