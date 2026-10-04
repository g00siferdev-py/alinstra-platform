"use server";

import { clientIp, getCounter } from "@alinstra/auth";
import { createLead, leadAdminNotice } from "@alinstra/db";
import { enqueueSendAdminNotice } from "@alinstra/queue";
import { headers } from "next/headers";

const LEAD_LIMIT = 5;
const LEAD_WINDOW_SECONDS = 60 * 60;

export type LeadFormState =
  | { ok: true }
  | { ok: false; error: string }
  | null;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function submitLeadAction(_prev: LeadFormState, formData: FormData): Promise<LeadFormState> {
  // Honeypot: bots fill hidden fields; pretend success so they leave.
  if (field(formData, "company_url").trim()) {
    return { ok: true };
  }

  try {
    const headerList = await headers();
    const request = new Request("http://localhost/start", { headers: headerList });
    const ip = clientIp(request);
    const count = await getCounter().increment(`lead:${ip}`, LEAD_WINDOW_SECONDS);
    if (count > LEAD_LIMIT) {
      return { ok: false, error: "Too many submissions from this network. Try again in an hour." };
    }

    const industrySelect = field(formData, "industry");
    const industryOther = field(formData, "industryOther").trim();
    const industry =
      industrySelect === "other" && industryOther
        ? `other:${industryOther}`
        : industrySelect;

    const lead = await createLead({
      business: field(formData, "business"),
      name: field(formData, "name"),
      phone: field(formData, "phone"),
      email: field(formData, "email"),
      industry,
      missedCalls: field(formData, "missedCalls"),
      notes: field(formData, "notes"),
      source: "marketing",
    });
    await enqueueSendAdminNotice(leadAdminNotice(lead));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not send that. Try again." };
  }
}
