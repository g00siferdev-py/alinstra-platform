import type { QuestionBank } from "./types";
import { textFilled } from "./types";

/** Industry-neutral bank. Always loaded; HVAC/vet banks append after this. */
export const generalBank: QuestionBank = {
  industry: "general",
  items: [
    {
      id: "gen.hours",
      question:
        "What are your regular business hours? Include lunch breaks and any holiday closures Ava should know about.",
      required: true,
      fields: ["knowledge.hours", "coverage.lunchHours", "coverage.holidays"],
      done: (c) => textFilled(c.knowledge?.hours, 8),
      followUp: (c) =>
        textFilled(c.knowledge?.hours, 8) && !textFilled(c.coverage?.lunchHours) && !textFilled(c.coverage?.holidays)
          ? "Do you close for lunch, and are there holidays when callers should hear a special message?"
          : null,
    },
    {
      id: "gen.services",
      question: "What services or work should Ava tell callers you offer?",
      required: true,
      fields: ["knowledge.services"],
      done: (c) => textFilled(c.knowledge?.services, 8),
    },
    {
      id: "gen.faqs",
      question: "What do callers ask most often, and what should Ava say?",
      required: true,
      fields: ["knowledge.faqs"],
      done: (c) => textFilled(c.knowledge?.faqs, 8),
    },
    {
      id: "gen.pricing",
      question: "What should Ava say about pricing or estimates? (It is fine to say you do not quote prices on the phone.)",
      required: false,
      fields: ["knowledge.policies"],
      done: (c) => textFilled(c.knowledge?.policies, 8),
    },
    {
      id: "gen.transfers",
      question:
        "Who should Ava transfer a live call to, and in what situations? Name the person or desk only — we will collect phone numbers later in the form, not in chat.",
      required: true,
      fields: ["features.transferTargetsText", "features.liveTransfer"],
      done: (c) => textFilled(c.features?.transferTargetsText, 3) || c.features?.liveTransfer === false,
    },
    {
      id: "gen.nobody_picks_up",
      question: "If nobody picks up a transfer, what should Ava do?",
      required: true,
      fields: ["coverage.holdOverflow", "features.messages"],
      done: (c) => textFilled(c.coverage?.holdOverflow, 5) || textFilled(c.features?.messages, 5),
    },
    {
      id: "gen.after_hours",
      question: "What should Ava do or say after hours and on weekends?",
      required: true,
      fields: ["coverage.afterHours", "coverage.weekends"],
      done: (c) => textFilled(c.coverage?.afterHours, 5),
    },
    {
      id: "gen.emergencies",
      question: "How should Ava handle emergencies or urgent calls?",
      required: true,
      fields: ["features.emergencyHandling"],
      done: (c) => textFilled(c.features?.emergencyHandling, 5),
    },
    {
      id: "gen.message_recipients",
      question: "When Ava takes a message, who should receive it (names or roles is fine; emails can be added in the form)?",
      required: true,
      fields: ["features.messageRecipients", "features.messages"],
      done: (c) => textFilled(c.features?.messageRecipients, 3) || textFilled(c.features?.messages, 5),
    },
    {
      id: "gen.booking",
      question: "Should Ava book on a calendar directly, or only take appointment requests for the office to confirm?",
      required: true,
      fields: ["features.bookingMode"],
      done: (c) => c.features?.bookingMode === "request_only",
    },
    {
      id: "gen.greeting",
      question: "What should callers hear as the greeting, and what name should the receptionist use?",
      required: true,
      fields: ["voice.greeting", "voice.assistantName"],
      done: (c) => textFilled(c.voice?.greeting, 5) || textFilled(c.voice?.assistantName, 2),
    },
    {
      id: "gen.must_not",
      question: "Is there anything callers must NOT be told — topics, prices, medical or legal advice, or people Ava should never mention?",
      required: false,
      fields: ["knowledge.policies", "voice.tone"],
      done: (c) => textFilled(c.knowledge?.policies, 12),
    },
  ],
};
