/**
 * Reads the JSON object out of a model's reply.
 *
 * Asked for JSON, models still sometimes wrap it in a ```json fence or add a
 * sentence before or after it. That is the same answer, not a broken one, so
 * the object is taken from the first `{` to the last `}` before giving up.
 * A reply that was cut off mid-object still fails here, as it should: half a
 * recipe is not a recipe.
 */
export function parseJsonReply(text: string): { ok: true; value: unknown } | { ok: false } {
  const attempts = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) attempts.push(fenced[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) attempts.push(text.slice(start, end + 1));

  for (const candidate of attempts) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // try the next reading
    }
  }
  return { ok: false };
}

/** The start and end of a reply, for a log line that shows where it went wrong. */
export function describeReply(text: string): string {
  if (text.length <= 600) return text;
  return `${text.slice(0, 300)} … [${text.length - 600} chars] … ${text.slice(-300)}`;
}
