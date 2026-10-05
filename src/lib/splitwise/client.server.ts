/**
 * The Splitwise REST API, as much of it as this app needs.
 *
 * Server-only, and more strictly than the model keys: those can spend a capped
 * budget, while this token can read and write the owner's entire expense
 * history with everyone they share with. It is read from the environment here
 * and never travels anywhere near a browser.
 */

const BASE = "https://secure.splitwise.com/api/v3.0";

/** One attempt's deadline, so a slow call cannot sit on the request budget. */
const TIMEOUT_MS = 15000;

export interface SplitwiseGroup {
  id: number;
  name: string;
  members: { id: number; name: string }[];
}

export interface SplitwiseError extends Error {
  status: number;
  detail: string;
  /** true for a rate limit, which is worth saying differently */
  busy: boolean;
}

function fail(status: number, detail: string): never {
  const error = new Error(`Splitwise returned ${status}`) as SplitwiseError;
  error.status = status;
  error.detail = detail;
  error.busy = status === 429 || status >= 500;
  throw error;
}

/**
 * Pulls the human-readable complaint out of a Splitwise error body.
 *
 * It has three shapes depending on the endpoint — a bare string, a list under
 * `errors.base`, or a per-field map — and the raw JSON is no use in a toast.
 */
function readMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: string;
      errors?: Record<string, string[]> | string[];
    };
    if (parsed.error) return parsed.error;
    const errors = parsed.errors;
    if (Array.isArray(errors)) return errors.join("; ");
    if (errors && typeof errors === "object") {
      return Object.entries(errors)
        .map(([field, messages]) => `${field}: ${(messages as string[]).join(", ")}`)
        .join("; ");
    }
    return body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

async function call(
  path: string,
  token: string,
  init?: { method?: string; form?: Record<string, string> },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(init?.form ? { body: new URLSearchParams(init.form).toString() } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      fail(504, "Splitwise took too long to answer");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const body = await response.text();
  if (!response.ok) fail(response.status, readMessage(body));

  const parsed = JSON.parse(body) as Record<string, unknown>;
  // A 200 does not mean it worked: create_expense answers with its complaints
  // in the body and the status still 200, so the body is checked too.
  const errors = parsed["errors"];
  if (errors && Object.keys(errors as object).length) fail(422, readMessage(body));
  return parsed;
}

export function getToken(): string | null {
  return process.env["SPLITWISE_API_KEY"] ?? null;
}

/** The account the token belongs to — the person who will have paid. */
export async function getCurrentUser(token: string): Promise<{ id: number; name: string }> {
  const data = (await call("/get_current_user", token)) as {
    user?: { id?: number; first_name?: string; last_name?: string };
  };
  const user = data.user;
  if (!user?.id) fail(502, "Splitwise did not say who the token belongs to");
  return {
    id: user.id,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || "You",
  };
}

/** The token owner's groups, so the house can be picked from a list. */
export async function getGroups(token: string): Promise<SplitwiseGroup[]> {
  const data = (await call("/get_groups", token)) as {
    groups?: {
      id?: number;
      name?: string;
      members?: { id?: number; first_name?: string; last_name?: string }[];
    }[];
  };
  return (
    (data.groups ?? [])
      // Group 0 is Splitwise's bucket for expenses that belong to no group; it is
      // not somewhere a house splits its shopping.
      .filter((g) => typeof g.id === "number" && g.id !== 0)
      .map((g) => ({
        id: g.id!,
        name: g.name ?? "Untitled group",
        members: (g.members ?? [])
          .filter((m) => typeof m.id === "number")
          .map((m) => ({
            id: m.id!,
            name: [m.first_name, m.last_name].filter(Boolean).join(" ") || `#${m.id}`,
          })),
      }))
  );
}

/**
 * Creates one expense from custom shares.
 *
 * Shares rather than split_equally even when the split is equal: a shop is
 * often shared by some of the house and not all of it, and one code path that
 * always says exactly who owes what is easier to trust than two.
 */
export async function createExpense(
  token: string,
  expense: {
    groupId: number;
    cost: string;
    description: string;
    details: string;
    /** YYYY-MM-DD, the day of the shop rather than the day it was sent */
    date: string;
    shares: Record<string, string>;
  },
): Promise<number> {
  const data = (await call("/create_expense", token, {
    method: "POST",
    form: {
      group_id: String(expense.groupId),
      cost: expense.cost,
      description: expense.description,
      details: expense.details,
      date: expense.date,
      currency_code: process.env["SPLITWISE_CURRENCY"] ?? "USD",
      ...expense.shares,
    },
  })) as { expenses?: { id?: number }[] };

  const id = data.expenses?.[0]?.id;
  if (!id) fail(502, "Splitwise accepted the expense but did not return its id");
  return id;
}
