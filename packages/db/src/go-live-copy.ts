/** Shared owner copy for the welcome email and the portal "Ava is live" card. */

export const CARRIER_FORWARDING_LINKS = [
  { name: "AT&T", href: "https://www.att.com/support/article/u-verse-voice/KM1009422/" },
  { name: "Verizon", href: "https://www.verizon.com/support/call-forwarding-faqs/" },
  { name: "T-Mobile", href: "https://www.t-mobile.com/support/plans-features/call-forwarding" },
  { name: "Google Voice", href: "https://support.google.com/voice/answer/115082" },
] as const;

export const OWNER_HELD_MESSAGE =
  "We're doing a quick check on your setup before Ava starts answering. You'll hear from us within one business day. Questions? Reply to this email.";

export function avaLiveWelcomeText(input: { businessName: string; phone: string; tollFree: string | null }): string {
  const help = input.tollFree
    ? `Need a hand? Reply to this email or call ${input.tollFree}.`
    : "Need a hand? Reply to this email.";
  const carriers = CARRIER_FORWARDING_LINKS.map((link) => `${link.name}: ${link.href}`).join("\n");
  return [
    `${input.businessName}: Ava is live.`,
    "",
    `Ava's number: ${input.phone}`,
    "Call Ava now so you hear her first.",
    "",
    "Two ways to use her:",
    "",
    "Keep your number. Set up conditional call forwarding with your carrier so unanswered or busy calls go to Ava's number.",
    carriers,
    "",
    "Use Ava's number as your business line. Put it on the truck, the cards, and your Google Business Profile.",
    "",
    help,
  ].join("\n");
}
