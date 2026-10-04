import { ASSISTANT_NAME } from "@/lib/brand";

/**
 * Audience cards for /industries ("Who it's for").
 * `slug` is reserved for future `/for/[slug]` landing pages — do not add those routes yet.
 */
export type MarketingAudience = {
  title: string;
  slug: string;
  blurb: string;
  /** Wizard `industry` enum value when creating a client from a lead, when it maps cleanly. */
  wizardIndustry?: string;
};

export const MARKETING_AUDIENCES: MarketingAudience[] = [
  {
    title: "HVAC & home services",
    slug: "hvac-home-services",
    wizardIndustry: "hvac",
    blurb: `Your techs are on roofs and in crawlspaces. ${ASSISTANT_NAME} takes the "my AC just died" call at 9 p.m., gets the address and the problem to the on-call tech, or books the morning slot. Come fall, hand her your maintenance-plan list and she calls to schedule the furnace tune-up before the first cold snap.`,
  },
  {
    title: "Veterinary",
    slug: "veterinary",
    wizardIndustry: "veterinary",
    blurb: `Front desk slammed, three on hold, the phone keeps ringing. ${ASSISTANT_NAME} takes the refill request and the "is this an emergency" call, gives your after-hours instructions word for word, and never guesses on medical advice. And when a patient's rabies booster or flea refill comes due, give ${ASSISTANT_NAME} the recall list and she calls the owner and books the visit, so that list stops being a sticky note.`,
  },
  {
    title: "Salons & grooming",
    slug: "salons-grooming",
    wizardIndustry: "salon_spa",
    blurb: `You're with a client and the phone won't stop. ${ASSISTANT_NAME} takes the booking, the reschedule, and the "do you have an opening Saturday" call, so the chair stays full and the front desk stays calm.`,
  },
  {
    title: "Auto repair",
    slug: "auto-repair",
    wizardIndustry: "auto_repair",
    blurb: `The bay is full and the phone is ringing. ${ASSISTANT_NAME} takes the estimate request, the status check, and the tow-in, then gets the details to you without pulling a tech off a lift.`,
  },
  {
    title: "Contractors & trades",
    slug: "contractors-trades",
    wizardIndustry: "home_services",
    blurb: `You're on a job site when the next lead calls. ${ASSISTANT_NAME} answers, takes the address and the scope, and books the estimate — so the call doesn't go to the next name on the list.`,
  },
  {
    title: "Law & accounting offices",
    slug: "law-accounting",
    wizardIndustry: "professional_services",
    blurb: `Intake never waits for a free moment. ${ASSISTANT_NAME} answers, takes the caller’s name and reason, and gets the message to the right person — without guessing on advice.`,
  },
  {
    title: "Property management",
    slug: "property-management",
    wizardIndustry: "professional_services",
    blurb: `Tenants call when something breaks — nights and weekends included. ${ASSISTANT_NAME} takes the unit, the issue, and the urgency, then routes it so maintenance isn't hunting through voicemail.`,
  },
  {
    title: "Restaurants & catering",
    slug: "restaurants-catering",
    wizardIndustry: "other",
    blurb: `Service is slammed and the phone keeps ringing. ${ASSISTANT_NAME} takes the reservation, the catering inquiry, and the "are you open" call so the floor stays focused on the room.`,
  },
];

/** Final card on Who it's for — not a future /for/ route yet. */
export const MARKETING_AUDIENCE_COMING: MarketingAudience = {
  title: "Healthcare & wellness (coming)",
  slug: "healthcare-wellness",
  blurb:
    "Dental, med spa, chiropractic, and medical weight management: coming with a HIPAA-ready tier.",
};

/** Industry options for the /start lead form (audiences + Other). */
export const LEAD_FORM_INDUSTRIES = [
  ...MARKETING_AUDIENCES.map((row) => ({ value: row.slug, label: row.title })),
  { value: "other", label: "Other (tell us)" },
] as const;
