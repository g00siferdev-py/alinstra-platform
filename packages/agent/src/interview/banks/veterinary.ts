import type { QuestionBank } from "./types";
import { textFilled } from "./types";

export const veterinaryBank: QuestionBank = {
  industry: "veterinary",
  items: [
    {
      id: "vet.emergency_er",
      question:
        "What should Ava say for emergencies after hours, and which nearest emergency clinic or ER should she mention?",
      required: true,
      fields: ["features.emergencyHandling", "coverage.afterHours"],
      done: (c) => textFilled(c.features?.emergencyHandling, 12),
    },
    {
      id: "vet.species",
      question: "Which animals / species do you see? Any you do not?",
      required: true,
      fields: ["knowledge.services"],
      done: (c) => textFilled(c.knowledge?.services, 8),
    },
    {
      id: "vet.boarding_grooming",
      question: "Do you offer boarding or grooming? What should Ava say about availability?",
      required: false,
      fields: ["knowledge.services", "knowledge.faqs"],
      done: (c) => /board|groom/i.test(`${c.knowledge?.services ?? ""} ${c.knowledge?.faqs ?? ""}`),
    },
    {
      id: "vet.refills",
      question: "How should Ava handle prescription refill requests?",
      required: true,
      fields: ["knowledge.faqs", "knowledge.policies"],
      done: (c) => /refill|prescription|rx/i.test(`${c.knowledge?.faqs ?? ""} ${c.knowledge?.policies ?? ""}`),
    },
    {
      id: "vet.euthanasia",
      question:
        "How should Ava handle calls about a dying pet or euthanasia — with care, without medical advice, and with clear next steps?",
      required: true,
      fields: ["knowledge.policies", "features.emergencyHandling"],
      done: (c) =>
        /euthan|dying|end of life|put down|quality of life/i.test(
          `${c.knowledge?.policies ?? ""} ${c.features?.emergencyHandling ?? ""} ${c.knowledge?.faqs ?? ""}`,
        ),
    },
    {
      id: "vet.no_advice",
      question: "Confirm: Ava must never give medical advice. Any other clinical topics she must refuse?",
      required: true,
      fields: ["knowledge.policies", "compliance.healthcareSensitive"],
      done: (c) =>
        c.compliance?.healthcareSensitive === true ||
        /no medical advice|not a vet|cannot diagnose/i.test(c.knowledge?.policies ?? ""),
    },
  ],
};
