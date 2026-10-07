import { memoryText, ProviderRequestError } from "@alinstra/providers";
import { describe, expect, it } from "vitest";
import { banksFor } from "./banks";
import {
  buildCapabilitiesBlock,
  CALENDAR_BOOKING_AVAILABLE,
  detectsCapabilityClaim,
} from "./capabilities";
import {
  classifyInterviewError,
  interviewTurn,
  initialInterviewState,
  summaryReply,
} from "./engine";
import { contradictionQuestion, mergeIntoDraft } from "./merge";
import { INTERVIEW_SYSTEM_PROMPT, buildInterviewSystemPrompt, buildInterviewUserPayload } from "./prompt";
import {
  forgiveInterviewUpdates,
  INTERVIEW_UPDATES_SHAPE,
  parseModelTurnForgiving,
  validateInterviewUpdates,
} from "./validate";

function modelJson(partial: {
  confirmation?: string;
  reply?: string;
  updates?: Record<string, unknown>;
  answerStatus?: string;
  followUp?: string | null;
}) {
  return JSON.stringify({
    confirmation: partial.confirmation ?? partial.reply ?? "Noted.",
    updates: partial.updates ?? {},
    answerStatus: partial.answerStatus ?? "answered",
    followUp: partial.followUp ?? null,
  });
}

describe("interview banks", () => {
  it("loads general plus industry extras", () => {
    expect(banksFor("general").every((item) => item.id.startsWith("gen."))).toBe(true);
    expect(banksFor("hvac").some((item) => item.id.startsWith("hvac."))).toBe(true);
    expect(banksFor("veterinary").some((item) => item.id.startsWith("vet."))).toBe(true);
  });
});

describe("interview prompt shape", () => {
  it("documents allowed updates fields and string-list rules", () => {
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("knowledge");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("bookingMode");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("All text fields are plain strings");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("Never invent field names");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("wellness exams");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("coverage.afterHours");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("confirmation");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("answerStatus");
    expect(INTERVIEW_SYSTEM_PROMPT).not.toContain("askedId");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("Vary how you start");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("weeklyHoursText");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("transferNotes");
    expect(INTERVIEW_UPDATES_SHAPE).not.toContain("transferTargetsText");
    expect(INTERVIEW_SYSTEM_PROMPT).toContain("Mon-Fri 8am-5pm");
  });

  it("tells the model the exact current question and does not suggest next", () => {
    const state = initialInterviewState("general");
    const payload = buildInterviewUserPayload(state, "Open 9-5");
    expect(payload).toContain("The owner is answering: gen.hours");
    expect(payload).toContain("File the answer in:");
    expect(payload).not.toContain("Suggested next");
  });
});

describe("forgiving updates", () => {
  it("joins string arrays and drops unknown keys", () => {
    const result = forgiveInterviewUpdates({
      knowledge: { services: ["wellness exams", "surgery", "dental"] },
      invented: { foo: "bar" },
      features: { imaginaryFlag: true, bookingMode: "request_only" },
    });
    expect(result.value.knowledge?.services).toBe("wellness exams, surgery, dental");
    expect(result.value.features?.bookingMode).toBe("request_only");
    expect(result.droppedPaths).toEqual(expect.arrayContaining(["invented", "features.imaginaryFlag"]));
    expect(result.droppedReasons.some((r) => r.startsWith("features.imaginaryFlag:"))).toBe(true);
  });

  it("keeps valid fields when one enum is invalid", () => {
    const result = forgiveInterviewUpdates({
      knowledge: { hours: "9-5" },
      features: { bookingMode: "telepathy", liveTransfer: true },
    });
    expect(result.value.knowledge?.hours).toBe("9-5");
    expect(result.value.features?.liveTransfer).toBe(true);
    expect(result.value.features?.bookingMode).toBeUndefined();
    expect(result.droppedPaths).toContain("features.bookingMode");
  });

  it("rejects textConfirmations, textReminders, direct_calendar and transferTargetsText; accepts transferNotes", () => {
    const result = forgiveInterviewUpdates({
      features: {
        textConfirmations: true,
        textReminders: false,
        bookingMode: "direct_calendar",
        liveTransfer: true,
        transferTargetsText: "Owner, +14235550142",
        transferNotes: "Owner for sales quotes",
      },
    });
    expect(result.value.features?.liveTransfer).toBe(true);
    expect(result.value.features?.bookingMode).toBeUndefined();
    expect(result.value.features?.transferNotes).toBe("Owner for sales quotes");
    expect(result.value.features && "transferTargetsText" in result.value.features).toBe(false);
    expect(result.droppedPaths).toEqual(
      expect.arrayContaining([
        "features.textConfirmations",
        "features.textReminders",
        "features.bookingMode",
        "features.transferTargetsText",
      ]),
    );
  });

  it("accepts weeklyHoursText only when parseWeeklyHours would pass", () => {
    const ok = forgiveInterviewUpdates({
      features: { weeklyHoursText: "mon 08:00-17:00\nfri 08:00-17:00" },
    });
    expect(ok.value.features?.weeklyHoursText).toContain("mon 08:00-17:00");
    const bad = forgiveInterviewUpdates({
      features: { weeklyHoursText: "mon 17:00-08:00" },
    });
    expect(bad.value.features?.weeklyHoursText).toBeUndefined();
    expect(bad.droppedPaths).toContain("features.weeklyHoursText");
    expect(bad.droppedReasons.some((r) => r.includes("closing time before opening"))).toBe(true);
  });

  it("raw fallback never writes weeklyHoursText or transferTargetsText", async () => {
    const { primaryStringField } = await import("./fields");
    expect(primaryStringField(["knowledge.hours", "features.weeklyHoursText"])).toBe("knowledge.hours");
    expect(primaryStringField(["features.transferNotes", "features.liveTransfer"])).toBe(
      "features.transferNotes",
    );
    expect(primaryStringField(["features.weeklyHoursText"])).toBeNull();
    expect(primaryStringField(["features.transferTargetsText" as never])).toBeNull();
  });
});

describe("capabilities", () => {
  it("solo has no calendar promise; professional has once-connected", () => {
    expect(CALENDAR_BOOKING_AVAILABLE).toBe(false);
    const solo = buildCapabilitiesBlock("solo");
    expect(solo).not.toMatch(/once.*connected/i);
    expect(solo).toMatch(/takes the request/i);
    const pro = buildCapabilitiesBlock("professional");
    expect(pro).toMatch(/once your calendar is connected/i);
    expect(buildInterviewSystemPrompt("solo")).toContain(solo);
  });

  it("sets bookingMode request_only and never asks gen.booking", () => {
    const state = initialInterviewState("general", { planCode: "solo" });
    expect(state.collected.features?.bookingMode).toBe("request_only");
    expect(state.answeredQuestions).toContain("gen.booking");
    expect(state.autoAnsweredQuestions).toContain("gen.booking");
    expect(state.openQuestions).not.toContain("gen.booking");
    expect(state.currentQuestionId).toBe("gen.hours");
    expect(state.askCounts["gen.hours"]).toBe(1);
  });

  it("flags calendar claims but not scheduling FAQs", () => {
    expect(detectsCapabilityClaim("She can check your calendar")).toBe(true);
    expect(detectsCapabilityClaim("callers ask about scheduling")).toBe(false);
  });
});

describe("interviewTurn", () => {
  it("asks next question and applies valid updates", async () => {
    const text = memoryText([
      modelJson({
        confirmation: "Open weekdays 9 to 5.",
        updates: { knowledge: { hours: "Mon-Fri 9:00-17:00" } },
        answerStatus: "answered",
      }),
    ]);
    const state = initialInterviewState("general");
    const result = await interviewTurn({
      state,
      userMessage: "We're open Monday through Friday, 9 to 5.",
      text,
    });
    expect(result.done).toBe(false);
    expect(result.state.collected.knowledge?.hours).toMatch(/9/);
    expect(result.state.answeredQuestions).toContain("gen.hours");
    expect(result.reply).toMatch(/services/i);
    expect(result.state.tokenUsage.inputTokens).toBeGreaterThan(0);
    expect(result.state.turnLog?.[0]?.parseOk).toBe(true);
    expect(result.state.currentQuestionId).toBe("gen.services");
  });

  it("saves services returned as an array and still shows the confirmation plus next question", async () => {
    const text = memoryText([
      modelJson({
        confirmation: "Got those services.",
        updates: {
          knowledge: {
            services: ["wellness exams", "surgery", "dental", "boarding", "grooming"],
          },
        },
        answerStatus: "answered",
      }),
    ]);
    const state = initialInterviewState("general");
    state.currentQuestionId = "gen.services";
    state.askCounts = { "gen.services": 1 };
    state.answeredQuestions = ["gen.hours", "gen.booking"];
    state.openQuestions = state.openQuestions.filter((id) => id !== "gen.hours" && id !== "gen.booking");
    state.collected = { knowledge: { hours: "Mon-Fri 9-5" }, features: { bookingMode: "request_only" } };
    const result = await interviewTurn({
      state,
      userMessage: "We do wellness exams, surgery, dental, boarding, and grooming.",
      text,
    });
    expect(result.state.collected.knowledge?.services).toBe(
      "wellness exams, surgery, dental, boarding, grooming",
    );
    expect(result.reply).toMatch(/Got those services/i);
    expect(result.reply).toMatch(/callers ask|common|FAQ|often/i);
    expect(result.reply).not.toMatch(/could not read|structured update/i);
  });

  it("drops an unknown key, keeps the confirmation, and logs the dropped path with reason", async () => {
    const text = memoryText([
      modelJson({
        confirmation: "Thanks — noted.",
        updates: {
          knowledge: { hours: "Mon-Fri 9-5" },
          mysterySection: { foo: 1 },
        },
        answerStatus: "answered",
      }),
    ]);
    const state = initialInterviewState("general");
    const result = await interviewTurn({
      state,
      userMessage: "Open weekdays 9 to 5",
      text,
    });
    expect(result.state.collected.knowledge?.hours).toMatch(/9/);
    expect(result.state.lastDropped).toContain("mysterySection");
    expect(result.state.turnLog?.[0]?.droppedPaths).toContain("mysterySection");
    expect(result.state.turnLog?.[0]?.droppedReasons?.[0]).toMatch(/mysterySection:/);
    expect(result.reply).not.toMatch(/could not read|structured update/i);
  });

  it("saves other fields when one enum is invalid", async () => {
    const text = memoryText([
      modelJson({
        confirmation: "Got the hours.",
        updates: {
          knowledge: { hours: "9-5 weekdays" },
          features: { bookingMode: "telepathy", liveTransfer: false },
        },
        answerStatus: "answered",
      }),
    ]);
    const state = initialInterviewState("general");
    const result = await interviewTurn({
      state,
      userMessage: "Open 9-5, book somehow",
      text,
    });
    expect(result.state.collected.knowledge?.hours).toMatch(/9-5/);
    expect(result.state.collected.features?.liveTransfer).toBe(false);
    // interview may keep request_only from initial defaults
    expect(result.state.collected.features?.bookingMode).toBe("request_only");
    expect(result.state.lastDropped).toContain("features.bookingMode");
  });

  it("retries once then uses the human fallback when output is invalid twice", async () => {
    const text = memoryText(["not-json-at-all", "still{{{{broken"]);
    const state = initialInterviewState("general");
    const result = await interviewTurn({
      state,
      userMessage: "We are open 9 to 5",
      text,
    });
    expect(result.reply).toBe("Sorry, I lost my place for a second. Could you say that again?");
    expect(result.reply).not.toMatch(/structured update/i);
    expect(text.calls).toHaveLength(2);
    expect(text.calls[1]?.messages.at(-1)?.content).toMatch(/not valid JSON/i);
    expect(result.state.turnLog?.[0]?.parseOk).toBe(false);
  });

  it("accepts reply as confirmation for back-compat", async () => {
    const text = memoryText([
      JSON.stringify({
        reply: "Hours noted.",
        updates: { knowledge: { hours: "Mon-Fri 9-5" } },
        askedId: "gen.hours",
        done: false,
      }),
    ]);
    const state = initialInterviewState("general");
    const result = await interviewTurn({
      state,
      userMessage: "Open Mon-Fri 9-5",
      text,
    });
    expect(result.reply).toMatch(/Hours noted/i);
    expect(result.state.answeredQuestions).toContain("gen.hours");
  });

  it("surfaces hours vs tech-line contradictions once, then flags hours_conflict", async () => {
    const updates = {
      knowledge: { hours: "Office open until 5pm, closed after hours" },
      coverage: { afterHours: "Tech line on-call until 10pm for emergencies" },
      features: { emergencyHandling: "Dispatch on-call tech until 10pm" },
    };
    const text = memoryText([
      modelJson({ confirmation: "Noted the tech line.", updates, answerStatus: "answered" }),
      modelJson({ confirmation: "Still the same hours.", updates, answerStatus: "answered" }),
    ]);
    const state = initialInterviewState("hvac");
    const first = await interviewTurn({
      state,
      userMessage: "Office until 5, but techs until 10.",
      text,
    });
    expect(first.reply).toMatch(/confirm|which|tech|on-call|schedule/i);
    expect(contradictionQuestion(first.state.collected)).toMatch(/confirm|which/i);
    expect(first.state.askedContradictions?.length).toBe(1);
    expect(first.state.needsReviewQuestions).not.toContain("hours_conflict");

    const second = await interviewTurn({
      state: first.state,
      userMessage: "Yes those are the hours.",
      text,
    });
    expect(second.state.needsReviewQuestions).toContain("hours_conflict");
    expect(second.reply).not.toBe(first.reply);
    expect(second.state.askedContradictions?.length).toBe(1);
  });

  it("stops with a friendly message when the token budget is exceeded", async () => {
    const text = memoryText([
      modelJson({
        confirmation: "More questions",
        updates: { knowledge: { hours: "9-5" } },
        answerStatus: "answered",
      }),
    ]);
    const state = initialInterviewState("general");
    state.tokenUsage = { inputTokens: 60_000, outputTokens: 0 };
    const result = await interviewTurn({
      state,
      userMessage: "We are open 9 to 5",
      text,
      budget: { inputTokens: 60_000, outputTokens: 12_000 },
    });
    expect(result.budgetExceeded).toBe(true);
    expect(result.done).toBe(true);
    expect(result.reply).toMatch(/usage limit|budget/i);
  });

  it("lawn-care: raw fallback fills after-hours when model files holdOverflow; never asks twice; one question in reply", async () => {
    // Engine asks required items before optional (pricing), so this script follows that order.
    const replies = [
      modelJson({
        confirmation: "Weekday hours noted.",
        updates: { knowledge: { hours: "Mon-Fri 8am-5pm" } },
      }),
      modelJson({
        confirmation: "Services noted.",
        updates: { knowledge: { services: "mowing, edging, leaf cleanup" } },
      }),
      modelJson({
        confirmation: "FAQs noted.",
        updates: { knowledge: { faqs: "How often? Weekly or biweekly." } },
      }),
      modelJson({
        confirmation: "Transfers noted.",
        updates: { features: { transferNotes: "Owner for sales", liveTransfer: true } },
      }),
      modelJson({
        confirmation: "Missed calls noted.",
        updates: { coverage: { holdOverflow: "Take a message and email the owner" } },
      }),
      // Wrong field: files after-hours answer under holdOverflow again
      modelJson({
        confirmation: "Callback for next business day.",
        updates: { coverage: { holdOverflow: "Schedule a call back for the next business day" } },
        answerStatus: "answered",
      }),
    ];
    const text = memoryText(replies);
    let state = initialInterviewState("general", { planCode: "solo" });
    const turns = [
      "Mon-Fri 8 to 5",
      "Mowing, edging, leaf cleanup",
      "How often — weekly or biweekly",
      "Owner for sales questions",
      "Take a message and email me",
      "Schedule a call back for the next business day",
    ];
    const asked: string[] = [];
    for (const message of turns) {
      const before = state.currentQuestionId;
      const result = await interviewTurn({ state, userMessage: message, text });
      state = result.state;
      if (before) asked.push(before);
      // Engine appends at most one next bank question (plus confirmation).
      const qMarks = (result.reply.match(/\?/g) ?? []).length;
      expect(qMarks).toBeLessThanOrEqual(2);
    }
    expect(state.collected.coverage?.afterHours).toMatch(/call back|callback|next business day/i);
    expect(state.answeredQuestions).toContain("gen.after_hours");
    expect(state.turnLog?.some((entry) => entry.fallback === "raw")).toBe(true);
    const counts = Object.values(state.askCounts);
    expect(counts.every((n) => n <= 2)).toBe(true);
    expect(asked).toEqual([
      "gen.hours",
      "gen.services",
      "gen.faqs",
      "gen.transfers",
      "gen.nobody_picks_up",
      "gen.after_hours",
    ]);
  });

  it('copies previous answer on "Same thing."', async () => {
    const text = memoryText([
      modelJson({
        confirmation: "Same as before.",
        updates: {},
        answerStatus: "answered",
      }),
    ]);
    const state = initialInterviewState("general");
    state.collected = {
      knowledge: { hours: "Mon-Fri 9-5", services: "lawn care" },
      features: { bookingMode: "request_only" },
    };
    // booking is answered but has no string primary field — copy from gen.services instead.
    state.answeredQuestions = ["gen.hours", "gen.services", "gen.booking"];
    state.currentQuestionId = "gen.faqs";
    state.askCounts = { "gen.hours": 1, "gen.services": 1, "gen.faqs": 1 };
    state.openQuestions = state.openQuestions.filter(
      (id) => !["gen.hours", "gen.services", "gen.booking"].includes(id),
    );
    const result = await interviewTurn({ state, userMessage: "Same thing.", text });
    expect(result.state.collected.knowledge?.faqs).toBe("lawn care");
    expect(result.state.turnLog?.[0]?.fallback).toBe("same");
    expect(result.state.answeredQuestions).toContain("gen.faqs");
  });

  it("skips after off_topic twice and marks needs review", async () => {
    const text = memoryText([
      modelJson({ confirmation: "Hmm.", answerStatus: "off_topic", followUp: null }),
      modelJson({ confirmation: "Still lost.", answerStatus: "off_topic", followUp: null }),
    ]);
    const state = initialInterviewState("general");
    expect(state.askCounts["gen.hours"]).toBe(1);
    const first = await interviewTurn({
      state,
      userMessage: "You seem to be stuck!",
      text,
    });
    expect(first.state.currentQuestionId).toBe("gen.hours");
    expect(first.state.askCounts["gen.hours"]).toBe(2);
    expect(first.reply).toMatch(/Sorry|turned around|So far/i);
    const second = await interviewTurn({
      state: first.state,
      userMessage: "You are asking me the same thing over and over",
      text,
    });
    expect(second.state.skippedQuestions).toContain("gen.hours");
    expect(second.state.needsReviewQuestions).toContain("gen.hours");
    expect(second.state.currentQuestionId).toBe("gen.services");
  });

  it("skips a required item on skip cue", async () => {
    const text = memoryText([
      modelJson({ confirmation: "Okay, skipping.", answerStatus: "skipped" }),
    ]);
    const state = initialInterviewState("general");
    const result = await interviewTurn({ state, userMessage: "skip", text });
    expect(result.state.skippedQuestions).toContain("gen.hours");
    expect(result.state.needsReviewQuestions).toContain("gen.hours");
    expect(result.state.currentQuestionId).toBe("gen.services");
  });

  it("treats whole-message skip cues only; real answers stay answered", async () => {
    const answered = memoryText([
      modelJson({ confirmation: "Callback plan noted.", answerStatus: "answered", updates: {} }),
      modelJson({ confirmation: "Passing calls noted.", answerStatus: "answered", updates: {} }),
    ]);
    const afterHours = initialInterviewState("general");
    afterHours.currentQuestionId = "gen.after_hours";
    afterHours.askCounts = { "gen.after_hours": 1 };
    afterHours.answeredQuestions = ["gen.hours", "gen.services", "gen.faqs", "gen.transfers", "gen.nobody_picks_up", "gen.booking"];
    afterHours.autoAnsweredQuestions = ["gen.booking"];
    afterHours.openQuestions = afterHours.openQuestions.filter(
      (id) => !afterHours.answeredQuestions.includes(id),
    );
    const nextBiz = await interviewTurn({
      state: afterHours,
      userMessage: "Next business day we call them back",
      text: answered,
    });
    expect(nextBiz.state.skippedQuestions).not.toContain("gen.after_hours");
    expect(nextBiz.state.answeredQuestions).toContain("gen.after_hours");
    expect(nextBiz.state.collected.coverage?.afterHours).toMatch(/Next business day/i);

    const transfers = initialInterviewState("general");
    transfers.currentQuestionId = "gen.transfers";
    transfers.askCounts = { "gen.transfers": 1 };
    transfers.answeredQuestions = ["gen.hours", "gen.services", "gen.faqs", "gen.booking"];
    transfers.autoAnsweredQuestions = ["gen.booking"];
    transfers.openQuestions = transfers.openQuestions.filter(
      (id) => !transfers.answeredQuestions.includes(id),
    );
    const passing = await interviewTurn({
      state: transfers,
      userMessage: "Passing calls to me is fine",
      text: answered,
    });
    expect(passing.state.skippedQuestions).not.toContain("gen.transfers");
    expect(passing.state.answeredQuestions).toContain("gen.transfers");

    for (const cue of ["skip", "Pass.", "skip for now"] as const) {
      const skipText = memoryText([
        modelJson({ confirmation: "Okay.", answerStatus: "answered" }),
      ]);
      const state = initialInterviewState("general");
      const result = await interviewTurn({ state, userMessage: cue, text: skipText });
      expect(result.state.skippedQuestions).toContain("gen.hours");
      expect(result.state.turnLog?.[0]?.answerStatus).toBe("skipped");
    }
  });

  it("progress line omits auto-answered booking; summary keeps booking sentence", async () => {
    const text = memoryText([
      modelJson({ confirmation: "Hmm.", answerStatus: "off_topic", followUp: null }),
    ]);
    const state = initialInterviewState("general");
    state.answeredQuestions = ["gen.hours", "gen.services", "gen.faqs", "gen.booking"];
    state.autoAnsweredQuestions = ["gen.booking"];
    state.currentQuestionId = "gen.transfers";
    state.askCounts = { "gen.transfers": 1 };
    state.collected = {
      knowledge: { hours: "9-5", services: "lawn", faqs: "price" },
      features: { bookingMode: "request_only" },
    };
    const result = await interviewTurn({
      state,
      userMessage: "You seem to be stuck!",
      text,
    });
    expect(result.reply).toMatch(/So far:/i);
    expect(result.reply).not.toMatch(/So far:[^.]*\bbooking\b/i);
    expect(result.reply).toMatch(/transfers/i);

    const done = initialInterviewState("general");
    done.answeredQuestions = ["gen.hours", "gen.booking"];
    done.autoAnsweredQuestions = ["gen.booking"];
    expect(summaryReply(done)).toMatch(/Appointment requests: Ava takes them/i);
  });

  it("done summary lists filled items and names skipped ones", async () => {
    const state = initialInterviewState("general");
    state.collected = {
      knowledge: { hours: "9-5", services: "lawn", faqs: "price?" },
      coverage: { afterHours: "callback", holdOverflow: "message" },
      features: {
        bookingMode: "request_only",
        transferNotes: "Owner",
        emergencyHandling: "Call 911 for life threat",
        messageRecipients: "Owner email",
      },
      voice: { greeting: "Thanks for calling", assistantName: "Ava" },
    };
    state.answeredQuestions = [
      "gen.hours",
      "gen.services",
      "gen.faqs",
      "gen.transfers",
      "gen.nobody_picks_up",
      "gen.after_hours",
      "gen.message_recipients",
      "gen.booking",
      "gen.greeting",
    ];
    state.skippedQuestions = ["gen.emergencies"];
    state.needsReviewQuestions = ["gen.emergencies"];
    state.openQuestions = [];
    const reply = summaryReply(state);
    expect(reply).toMatch(/hours/i);
    expect(reply).toMatch(/Appointment requests: Ava takes them/i);
    expect(reply).toMatch(/skipped emergencies/i);
    expect(reply).not.toMatch(/pricing/i);
  });

  it("sets capabilityFlag when confirmation overpromises calendar", async () => {
    const text = memoryText([
      modelJson({
        confirmation: "She can check your calendar for openings.",
        updates: { knowledge: { hours: "Mon-Fri 9-5" } },
        answerStatus: "answered",
      }),
    ]);
    const state = initialInterviewState("general");
    const result = await interviewTurn({
      state,
      userMessage: "Open 9-5",
      text,
    });
    expect(result.state.turnLog?.[0]?.capabilityFlag).toBe(true);
  });

  it("classifies ProviderRequestError 402 and AbortError", () => {
    expect(classifyInterviewError(new ProviderRequestError("pay", 402))).toBe("http_402");
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifyInterviewError(abort)).toBe("timeout");
  });

  it("stores classified error on turn log without message text", async () => {
    const text = {
      calls: [] as unknown[],
      async complete() {
        throw new ProviderRequestError("payment required", 402);
      },
    };
    const state = initialInterviewState("general");
    const result = await interviewTurn({
      state,
      userMessage: "secret owner hours phone 555-1212",
      text: text as never,
    });
    expect(result.state.turnLog?.[0]?.error).toBe("http_402");
    const logJson = JSON.stringify(result.state.turnLog?.[0]);
    expect(logJson).not.toMatch(/555-1212|secret owner/);
  });
});

describe("validate + mergeIntoDraft", () => {
  it("accepts partial payload updates", () => {
    const parsed = validateInterviewUpdates({
      voice: { assistantName: "Ava", greeting: "Thanks for calling." },
      features: { bookingMode: "request_only" },
    });
    expect(parsed.ok).toBe(true);
  });

  it("parseModelTurnForgiving keeps confirmation when updates are messy", () => {
    const parsed = parseModelTurnForgiving({
      confirmation: "Got it.",
      updates: { knowledge: { services: ["a", "b"] }, no_such: true },
      answerStatus: "answered",
      followUp: null,
    });
    expect(parsed.parseOk).toBe(true);
    expect(parsed.confirmation).toBe("Got it.");
    expect(parsed.updates.knowledge?.services).toBe("a, b");
    expect(parsed.droppedPaths).toContain("no_such");
  });

  it("merges into a draft without overwriting filled fields", () => {
    const draft: {
      version: number;
      knowledge: { hours?: string; services?: string };
      voice: { assistantName?: string; greeting?: string };
    } = {
      version: 1,
      knowledge: { hours: "Admin already set 8-4", services: "" },
      voice: { assistantName: "Desk" },
    };
    const merged = mergeIntoDraft(draft, {
      knowledge: { hours: "Interview 9-5", services: "HVAC repair" },
      voice: { assistantName: "Ava", greeting: "Hello" },
    });
    expect(merged.knowledge.hours).toBe("Admin already set 8-4");
    expect(merged.knowledge.services).toBe("HVAC repair");
    expect(merged.voice.assistantName).toBe("Desk");
    expect(merged.voice.greeting).toBe("Hello");
  });
});

describe("log scrub for turn_failed", () => {
  it("does not put owner message into classify fields", () => {
    const err = classifyInterviewError(new ProviderRequestError("Text API request failed (402): pay", 402));
    const fields = { sessionId: "sess", error: err, model: "kimi" };
    expect(JSON.stringify(fields)).not.toMatch(/owner|hours/i);
    expect(fields.error).toBe("http_402");
  });
});
