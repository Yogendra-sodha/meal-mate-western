/**
 * Accepts a YouTube link and returns the canonical watch URL, or null.
 *
 * The user's string is never passed to the model provider as given. Only a URL
 * rebuilt from a video id that matched this pattern is sent, so the field
 * cannot be used to point the request at some other address.
 */
export function canonicalYoutubeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let id = "";

  if (host === "youtu.be") {
    id = url.pathname.slice(1);
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v") ?? "";
    else if (url.pathname.startsWith("/shorts/")) id = url.pathname.slice("/shorts/".length);
    else if (url.pathname.startsWith("/embed/")) id = url.pathname.slice("/embed/".length);
    else if (url.pathname.startsWith("/live/")) id = url.pathname.slice("/live/".length);
  } else {
    return null;
  }

  id = id.split("/")[0] ?? "";
  // Video ids are exactly 11 characters of this alphabet; anything else is not one.
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}
