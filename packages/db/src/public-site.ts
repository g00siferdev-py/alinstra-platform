import { prisma } from "./client";

export type PublicSiteConfig = {
  phone: string | null;
  email: string;
};

const CACHE_MS = 60 * 60 * 1000;
const FALLBACK_EMAIL = "hello@alinstra.com";

let cached: { at: number; value: PublicSiteConfig } | null = null;

/** Test helper — clears the in-process cache between cases. */
export function resetPublicSiteConfigCache(): void {
  cached = null;
}

/**
 * Tenant-free site contact details for the marketing header and CTAs.
 * Prefers the internal client's publicPhone / publicEmail; falls back to MARKETING_PHONE and hello@alinstra.com.
 */
export async function publicSiteConfig(): Promise<PublicSiteConfig> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.value;

  const internal = await prisma.client.findFirst({
    where: { internal: true, archivedAt: null },
    select: { publicPhone: true, phoneE164: true, publicEmail: true },
  });
  const fallbackPhone = process.env.MARKETING_PHONE?.trim() || "";
  const phone =
    internal?.publicPhone?.trim() ||
    internal?.phoneE164?.trim() ||
    fallbackPhone ||
    null;
  const email = internal?.publicEmail?.trim() || FALLBACK_EMAIL;
  const value = { phone, email };
  cached = { at: now, value };
  return value;
}
