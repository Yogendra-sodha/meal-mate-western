/**
 * Making instructions scannable.
 *
 * Nobody reads a recipe. They glance at it with wet hands, find the next
 * action and the one number that matters, and put the phone down. Prose fights
 * that: "Knead soft rotli dough with wheat flour, water, oil and salt; rest 20
 * minutes" is two jobs and a shopping list in one line, and the eye has to
 * parse the whole thing to find either.
 *
 * So steps are cut where they genuinely hold two actions, and the two things
 * worth finding — what to do, and how long or how hot — are marked for the eye
 * rather than left in the middle of a sentence.
 *
 * Nothing here rewrites the words. A recipe says what it says; this only
 * decides where the line breaks and what is worth making bold.
 */

/** How long, in whatever units a recipe writes them. */
const TIME = /\b\d+(?:\s*[–-]\s*\d+)?\s*(?:min(?:ute)?s?|hours?|hrs?|sec(?:ond)?s?)\b/gi;

/**
 * How hot, but only where it is actually a setting.
 *
 * "on high", "over medium heat", "low flame" are settings. A bare "low" is
 * not — "low and slow", "low fat" — so a bare one is left alone.
 */
const HEAT =
  /\b(?:on|at|over|to)\s+(?:high|medium(?:[- ]high|[- ]low)?|low)(?:\s+(?:heat|flame))?\b|\b(?:high|medium(?:[- ]high|[- ]low)?|low)\s+(?:heat|flame)\b/gi;

/**
 * Splits a written step where it holds more than one action.
 *
 * A semicolon in these recipes always separates two jobs, and " then " nearly
 * always does. A comma does not — it usually separates ingredients, and
 * cutting there would turn one step into a list of half-sentences.
 */
export function splitStep(step: string): string[] {
  return (
    step
      .split(/\s*;\s*|\s+then\s+/i)
      .map((part) => part.trim().replace(/[,;]$/, ""))
      // A fragment of a word or two is a leftover, not a step of its own.
      .filter((part) => part.length > 2)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  );
}

/** Every step, cut into the single actions they contain. */
export function splitSteps(steps: string[]): string[] {
  return steps.flatMap(splitStep);
}

export type Piece = { text: string; kind: "action" | "cue" | "plain" };

/**
 * Breaks a step into the action, the cues, and the rest.
 *
 * The action is simply the first word: these are instructions, so the first
 * word is the verb — heat, add, soak, knead. No part-of-speech guessing, which
 * would be wrong often enough to be worse than useless.
 */
export function readStep(step: string): Piece[] {
  const trimmed = step.trim();
  if (!trimmed) return [];

  const firstSpace = trimmed.indexOf(" ");
  const action = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const remainder = firstSpace === -1 ? "" : trimmed.slice(firstSpace);

  const pieces: Piece[] = [{ text: action, kind: "action" }];
  pieces.push(...markCues(remainder));
  return pieces.filter((p) => p.text.length > 0);
}

/** Splits text into plain stretches and the cues worth spotting inside them. */
function markCues(text: string): Piece[] {
  const spans: { start: number; end: number }[] = [];
  for (const pattern of [TIME, HEAT]) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  if (!spans.length) return [{ text, kind: "plain" }];

  // Overlaps are possible where the two patterns meet; the earliest, longest
  // span wins so that a cue is never emitted twice.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: typeof spans = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) continue;
    merged.push(span);
  }

  const pieces: Piece[] = [];
  let at = 0;
  for (const span of merged) {
    if (span.start > at) pieces.push({ text: text.slice(at, span.start), kind: "plain" });
    pieces.push({ text: text.slice(span.start, span.end), kind: "cue" });
    at = span.end;
  }
  if (at < text.length) pieces.push({ text: text.slice(at), kind: "plain" });
  return pieces;
}
