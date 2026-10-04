import { STRIPE_API_VERSION } from "./types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ServiceHealth = { ok: true; detail: string } | { ok: false; error: string };

function redact(text: string, secret: string): string {
  const out = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  return secret.length >= 8 ? out.split(secret).join("[redacted]") : out;
}

async function describeFailure(response: Response, secret: string): Promise<string> {
  const text = (await response.text().catch(() => "")).trim();
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
    const nested = parsed.error && typeof parsed.error === "object" ? (parsed.error as { message?: unknown }) : null;
    const candidate = [parsed.message, parsed.error, nested?.message].find((value) => typeof value === "string" && value.trim());
    if (typeof candidate === "string") detail = candidate.trim();
  } catch {
    // Plain-text body; keep it as is.
  }
  return `HTTP ${response.status}${detail ? `: ${redact(detail, secret).slice(0, 300)}` : ""}`;
}

/** Cheapest authenticated Retell read: list one agent. Buys nothing, changes nothing. */
export async function checkRetellHealth(apiKey: string, fetchImpl: FetchLike = fetch): Promise<ServiceHealth> {
  if (!apiKey) return { ok: false, error: "RETELL_API_KEY is not set, so the in-memory fake is in use." };
  try {
    const response = await fetchImpl("https://api.retellai.com/v2/list-agents?limit=1", {
      method: "GET",
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return { ok: false, error: await describeFailure(response, apiKey) };
    const body = (await response.json().catch(() => null)) as unknown;
    const count = Array.isArray(body) ? body.length : Array.isArray((body as { items?: unknown } | null)?.items) ? ((body as { items: unknown[] }).items).length : 0;
    return { ok: true, detail: count > 0 ? "Authenticated. Agents are listed." : "Authenticated. No agents listed yet." };
  } catch (error) {
    return { ok: false, error: redact(error instanceof Error ? error.message : "Request failed", apiKey) };
  }
}

/** Cheapest authenticated Stripe read: the account balance. Charges nothing. */
export async function checkStripeHealth(secretKey: string, fetchImpl: FetchLike = fetch): Promise<ServiceHealth> {
  if (!secretKey) return { ok: false, error: "STRIPE_SECRET_KEY is not set, so the in-memory fake is in use." };
  try {
    const response = await fetchImpl("https://api.stripe.com/v1/balance", {
      method: "GET",
      headers: { authorization: `Bearer ${secretKey}`, "Stripe-Version": STRIPE_API_VERSION },
    });
    if (!response.ok) return { ok: false, error: await describeFailure(response, secretKey) };
    const body = (await response.json().catch(() => null)) as { livemode?: unknown } | null;
    const mode = body?.livemode === true ? "live mode" : body?.livemode === false ? "test mode" : "unknown mode";
    return { ok: true, detail: `Authenticated (${mode}, API ${STRIPE_API_VERSION}).` };
  } catch (error) {
    return { ok: false, error: redact(error instanceof Error ? error.message : "Request failed", secretKey) };
  }
}
