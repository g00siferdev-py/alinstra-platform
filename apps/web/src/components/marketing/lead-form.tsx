"use client";

import { submitLeadAction, type LeadFormState } from "@/app/(marketing)/start/actions";
import { Button, ErrorText, Input, Label } from "@/components/ui";
import { LEAD_FORM_INDUSTRIES } from "@/lib/marketing-audiences";
import { useActionState, useState } from "react";

const CONFIRMATION =
  "Thanks. We'll call you within one business day to walk through setup, and you'll be live within 24 hours of that call.";

export function LeadForm() {
  const [state, action, pending] = useActionState(submitLeadAction, null as LeadFormState);
  const [industry, setIndustry] = useState("");

  if (state?.ok) {
    return <p className="rounded-md border border-[var(--line)] bg-[var(--card)] p-4 text-[var(--ink)]">{CONFIRMATION}</p>;
  }

  return (
    <form action={action} className="grid gap-4">
      {/* Honeypot — leave empty. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="company_url">Company website</label>
        <input id="company_url" name="company_url" tabIndex={-1} autoComplete="off" />
      </div>

      <div>
        <Label htmlFor="business">Business name</Label>
        <Input id="business" name="business" required maxLength={200} />
      </div>
      <div>
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" type="tel" required maxLength={40} />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required maxLength={200} />
      </div>
      <div>
        <Label htmlFor="industry">Industry</Label>
        <select
          id="industry"
          name="industry"
          required
          className="w-full rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--ink)]"
          value={industry}
          onChange={(event) => setIndustry(event.target.value)}
        >
          <option value="" disabled>
            Choose one
          </option>
          {LEAD_FORM_INDUSTRIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {industry === "other" ? (
        <div>
          <Label htmlFor="industryOther">Tell us your industry</Label>
          <Input id="industryOther" name="industryOther" required maxLength={120} />
        </div>
      ) : (
        <input type="hidden" name="industryOther" value="" />
      )}
      <div>
        <Label htmlFor="missedCalls">Roughly how many calls you miss a week</Label>
        <select
          id="missedCalls"
          name="missedCalls"
          required
          className="w-full rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--ink)]"
          defaultValue=""
        >
          <option value="" disabled>
            Choose one
          </option>
          <option value="under_5">Fewer than 5</option>
          <option value="5_to_15">5–15</option>
          <option value="over_15">More than 15</option>
          <option value="not_sure">Not sure</option>
        </select>
      </div>
      <div>
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          maxLength={2000}
          className="w-full rounded-md border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--ink)] outline-none focus:border-[var(--accent)]"
        />
      </div>
      {state && !state.ok ? <ErrorText>{state.error}</ErrorText> : null}
      <Button disabled={pending} type="submit">
        {pending ? "Sending…" : "Send"}
      </Button>
    </form>
  );
}
