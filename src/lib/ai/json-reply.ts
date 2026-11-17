/**
 * Reads the JSON object out of a model's reply.
 *
 * Asked for JSON, models still sometimes wrap it in a ```json fence or add a
 * sentence before or after it. That is the same answer, not a broken one, so
 * the object is taken from the first `{` to the last `}` before giving up.
 *
 * Then small, known slips are repaired — each one seen in production:
 *   - a list written with its positions, `[\n0: "a",\n1: "b"\n]`
 *   - a comma left before a closing bracket
 *   - the last `}` or `]` left off a reply that had otherwise finished
 * Closing brackets is only done when the model said it stopped on its own
 * (`complete`): a reply cut off for length is half a recipe, and closing it
 * would dress that up as a whole one.
 */
export function parseJsonReply(
  text: string,
  { complete = true }: { complete?: boolean } = {},
): { ok: true; value: unknown } | { ok: false } {
  const readings = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) readings.push(fenced[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) readings.push(text.slice(start, end + 1));
  if (start !== -1) readings.push(text.slice(start).trim());

  const attempts: string[] = [];
  for (const reading of readings) {
    attempts.push(reading);
    const repaired = repair(reading);
    attempts.push(repaired);
    if (complete) attempts.push(closeOpenBrackets(repaired));
  }

  for (const candidate of attempts) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // try the next reading
    }
  }
  return { ok: false };
}

function repair(text: string): string {
  return (
    text
      // `0: "a"` at the start of a line inside a list. A JSON string cannot
      // hold a raw line break, so a match after a newline is never inside one.
      .replace(/([[,])\s*\n\s*\d+\s*:\s*/g, "$1\n")
      // trailing comma before a closer
      .replace(/,(\s*[}\]])/g, "$1")
  );
}

/** Appends whatever closers are still owed, ignoring brackets inside strings. */
function closeOpenBrackets(text: string): string {
  const open: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") open.push("}");
    else if (ch === "[") open.push("]");
    else if (ch === "}" || ch === "]") open.pop();
  }
  if (inString) return text;
  return text + open.reverse().join("");
}

/** The start and end of a reply, for a log line that shows where it went wrong. */
export function describeReply(text: string): string {
  if (text.length <= 600) return text;
  return `${text.slice(0, 300)} … [${text.length - 600} chars] … ${text.slice(-300)}`;
}
