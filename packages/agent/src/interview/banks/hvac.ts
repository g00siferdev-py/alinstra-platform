import type { QuestionBank } from "./types";
import { textFilled } from "./types";

export const hvacBank: QuestionBank = {
  industry: "hvac",
  items: [
    {
      id: "hvac.emergency_def",
      question:
        "For after-hours calls, what counts as an emergency versus something that can wait until the next business day? Who should urgent calls reach?",
      required: true,
      fields: ["features.emergencyHandling", "coverage.afterHours"],
      done: (c) => textFilled(c.features?.emergencyHandling, 12),
    },
    {
      id: "hvac.service_area",
      question: "What service area do you cover, and what should Ava say if a caller is outside it?",
      required: true,
      fields: ["knowledge.services", "knowledge.faqs"],
      done: (c) =>
        textFilled(c.knowledge?.services, 8) &&
        /area|mile|county|city|zip|town/i.test(`${c.knowledge?.services ?? ""} ${c.knowledge?.faqs ?? ""}`),
    },
    {
      id: "hvac.maintenance",
      question: "Do you offer maintenance plans? What should Ava say about them?",
      required: false,
      fields: ["knowledge.services", "knowledge.faqs"],
      done: (c) => /maint|tune-?up|plan|membership/i.test(`${c.knowledge?.services ?? ""} ${c.knowledge?.faqs ?? ""}`),
    },
    {
      id: "hvac.brands",
      question: "Which brands or equipment do you service? Any you do not?",
      required: false,
      fields: ["knowledge.services"],
      done: (c) => /brand|carrier|trane|lennox|rheem|goodman|york|daikin/i.test(c.knowledge?.services ?? ""),
    },
    {
      id: "hvac.tech_line_hours",
      question:
        "Are on-call / tech-line hours different from the front-office hours? If they differ, say both clearly so Ava does not mix them up.",
      required: true,
      fields: ["knowledge.hours", "coverage.afterHours", "features.emergencyHandling"],
      done: (c) => textFilled(c.coverage?.afterHours, 5) && textFilled(c.knowledge?.hours, 8),
    },
  ],
};
