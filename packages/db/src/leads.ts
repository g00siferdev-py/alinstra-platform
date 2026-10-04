import { prisma } from "./client";
import { assertTenantContext, type TenantContext } from "./tenant";
import type { Actor } from "./changes";

export const LEAD_INDUSTRIES = ["hvac_home", "veterinary", "other"] as const;
export const LEAD_MISSED_CALLS = ["under_5", "5_to_15", "over_15", "not_sure"] as const;

export type LeadIndustry = (typeof LEAD_INDUSTRIES)[number];
export type LeadMissedCalls = (typeof LEAD_MISSED_CALLS)[number];

export type CreateLeadInput = {
  business: string;
  name: string;
  phone: string;
  email: string;
  industry: string;
  missedCalls: string;
  notes?: string | null;
  source?: string;
};

function trimRequired(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") throw new Error(`Enter ${label}.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Enter ${label}.`);
  if (trimmed.length > max) throw new Error(`${label} is too long.`);
  return trimmed;
}

export function parseLeadInput(raw: CreateLeadInput): CreateLeadInput {
  const business = trimRequired(raw.business, "a business name", 200);
  const name = trimRequired(raw.name, "your name", 120);
  const phone = trimRequired(raw.phone, "a phone number", 40);
  const email = trimRequired(raw.email, "an email", 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email.");
  const industry = trimRequired(raw.industry, "an industry", 200);
  const missedCalls = trimRequired(raw.missedCalls, "how many calls you miss", 40);
  if (!(LEAD_MISSED_CALLS as readonly string[]).includes(missedCalls)) {
    throw new Error("Choose how many calls you miss a week.");
  }
  const notes =
    typeof raw.notes === "string" && raw.notes.trim()
      ? raw.notes.trim().slice(0, 2000)
      : null;
  return {
    business,
    name,
    phone,
    email,
    industry,
    missedCalls,
    notes,
    source: raw.source?.trim() || "marketing",
  };
}

export async function createLead(input: CreateLeadInput) {
  const data = parseLeadInput(input);
  return prisma.lead.create({
    data: {
      business: data.business,
      name: data.name,
      phone: data.phone,
      email: data.email,
      industry: data.industry,
      missedCalls: data.missedCalls,
      notes: data.notes,
      source: data.source ?? "marketing",
    },
  });
}

export async function listLeads(ctx: TenantContext) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only an admin can list leads.");
  return prisma.lead.findMany({ orderBy: { createdAt: "desc" } });
}

export async function markLeadContacted(ctx: Actor, id: string) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only an admin can update leads.");
  return prisma.lead.update({
    where: { id },
    data: { contactedAt: new Date() },
  });
}

export async function linkLeadToClient(ctx: Actor, leadId: string, clientId: string) {
  assertTenantContext(ctx);
  if (ctx.role !== "admin") throw new Error("Only an admin can update leads.");
  return prisma.lead.update({
    where: { id: leadId },
    data: { convertedClientId: clientId },
  });
}

const LEAD_INDUSTRY_LABELS: Record<string, string> = {
  "hvac-home-services": "HVAC & home services",
  hvac_home: "HVAC & home services",
  veterinary: "Veterinary",
  "salons-grooming": "Salons & grooming",
  "auto-repair": "Auto repair",
  "contractors-trades": "Contractors & trades",
  "law-accounting": "Law & accounting offices",
  "property-management": "Property management",
  "restaurants-catering": "Restaurants & catering",
};

export function leadIndustryLabel(value: string): string {
  if (value.startsWith("other:")) return value.slice("other:".length) || "Other";
  if (value === "other") return "Other (tell us)";
  return LEAD_INDUSTRY_LABELS[value] ?? value;
}

/** Maps a lead industry slug to a wizard industry code when one fits. */
export function leadIndustryToWizard(value: string): string {
  if (value.startsWith("other:")) return "other";
  const map: Record<string, string> = {
    "hvac-home-services": "hvac",
    hvac_home: "hvac",
    veterinary: "veterinary",
    "salons-grooming": "salon_spa",
    "auto-repair": "auto_repair",
    "contractors-trades": "home_services",
    "law-accounting": "professional_services",
    "property-management": "professional_services",
    "restaurants-catering": "other",
    other: "other",
  };
  return map[value] ?? "";
}

export function leadMissedCallsLabel(value: string): string {
  if (value === "under_5") return "Fewer than 5";
  if (value === "5_to_15") return "5–15";
  if (value === "over_15") return "More than 15";
  if (value === "not_sure") return "Not sure";
  return value;
}

export function leadAdminNotice(lead: {
  business: string;
  name: string;
  phone: string;
  email: string;
  industry: string;
  missedCalls: string;
  notes: string | null;
}): { subject: string; text: string } {
  const lines = [
    `Business: ${lead.business}`,
    `Name: ${lead.name}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email}`,
    `Industry: ${leadIndustryLabel(lead.industry)}`,
    `Missed calls / week: ${leadMissedCallsLabel(lead.missedCalls)}`,
  ];
  if (lead.notes) lines.push(`Notes: ${lead.notes}`);
  return {
    subject: `New lead: ${lead.business}`,
    text: lines.join("\n"),
  };
}
