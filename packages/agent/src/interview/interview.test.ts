import { memoryText } from "@alinstra/providers";
import { describe, expect, it } from "vitest";
import { banksFor } from "./banks";
import { interviewTurn, initialInterviewState } from "./engine";
import { contradictionQuestion, mergeIntoDraft } from "./merge";
import { INTERVIEW_SYSTEM_PROMPT } from "./prompt";
import { forgiveInterviewUpdates, parseModelTurnForgiving, validateInterviewUpdates } from "./validate";

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
});

describe("interviewTurn", () => {
  it("asks next question and applies valid updates", async () => {
    const text = memoryText([
      JSON.stringify({
        reply: "Got it — open weekdays 9 to 5. What services should Ava mention?",
        updates: { knowledge: { hours: "Mon-Fri 9:00-17:00" } },
        askedId: "gen.hours",
        done: false,
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
  });

  it("saves services returned as an array and still shows the reply", async () => {
    const text = memoryText([
      JSON.stringify({
        reply: "Got those services. Do you take emergency calls after hours?",
        updates: {
          knowledge: {
            services: ["wellness exams", "surgery", "dental", "boarding", "grooming"],
          },
        },
        askedId: "gen.services",
        done: false,
      }),
    ]);
    const state = initialInterviewState("general");
    const result = await interviewTurn({
      state,
      userMessage: "We do wellness exams, surgery, dental, boarding, and grooming.",
      text,
    });
    expect(result.reply).toMatch(/emergency|after hours/i);
    expect(result.state.collected.knowledge?.services).toBe(
      "wellness exams, surgery, dental, boarding, grooming",
    );
    expect(result.reply).not.toMatch(/could not read|structured update/i);
  });

  it("drops an unknown key, keeps the reply, and logs the dropped path", async () => {
    const text = memoryText([
      JSON.stringify({
        reply: "Thanks — noted. What about weekends?",
        updates: {
          knowledge: { hours: "Mon-Fri 9-5" },
          mysterySection: { foo: 1 },
        },
        askedId: "gen.hours",
        done: false,
      }),
    ]);
    const state = initialInterviewState("general");
    const result = await interviewTurn({
      state,
      userMessage: "Open weekdays 9 to 5",
      text,
    });
    expect(result.reply).toMatch(/weekends/i);
    expect(result.state.collected.knowledge?.hours).toMatch(/9/);
    expect(result.state.lastDropped).toContain("mysterySection");
    expect(result.state.turnLog?.[0]?.droppedPaths).toContain("mysterySection");
    expect(result.reply).not.toMatch(/could not read|structured update/i);
  });

  it("saves other fields when one enum is invalid", async () => {
    const text = memoryText([
      JSON.stringify({
        reply: "Got the hours. How do you want bookings handled?",
        updates: {
          knowledge: { hours: "9-5" },
          features: { bookingMode: "telepathy", liveTransfer: false },
        },
        askedId: "gen.hours",
        done: false,
      }),
    ]);
    const state = initialInterviewState("general");
    const result = await interviewTurn({
      state,
      userMessage: "Open 9-5, book somehow",
      text,
    });
    expect(result.state.collected.knowledge?.hours).toBe("9-5");
    expect(result.state.collected.features?.liveTransfer).toBe(false);
    expect(result.state.collected.features?.bookingMode).toBeUndefined();
    expect(result.state.lastDropped).toContain("features.bookingMode");
    expect(result.reply).toMatch(/bookings/i);
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

  it("surfaces hours vs tech-line contradictions", async () => {
    const text = memoryText([
      JSON.stringify({
        reply: "Noted the tech line.",
        updates: {
          knowledge: { hours: "Office open until 5pm, closed after hours" },
          coverage: { afterHours: "Tech line on-call until 10pm for emergencies" },
          features: { emergencyHandling: "Dispatch on-call tech until 10pm" },
        },
        askedId: "hvac.tech_line_hours",
        done: false,
      }),
    ]);
    const state = initialInterviewState("hvac");
    const result = await interviewTurn({
      state,
      userMessage: "Office until 5, but techs until 10.",
      text,
    });
    expect(result.reply).toMatch(/confirm|which|tech|on-call|schedule/i);
    expect(contradictionQuestion(result.state.collected)).toMatch(/confirm|which/i);
  });

  it("stops with a friendly message when the token budget is exceeded", async () => {
    const text = memoryText([
      JSON.stringify({
        reply: "More questions",
        updates: { knowledge: { hours: "9-5" } },
        askedId: "gen.hours",
        done: false,
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
});

describe("validate + mergeIntoDraft", () => {
  it("accepts partial payload updates", () => {
    const parsed = validateInterviewUpdates({
      voice: { assistantName: "Ava", greeting: "Thanks for calling." },
      features: { bookingMode: "request_only" },
    });
    expect(parsed.ok).toBe(true);
  });

  it("parseModelTurnForgiving keeps reply when updates are messy", () => {
    const parsed = parseModelTurnForgiving({
      reply: "Got it.",
      updates: { knowledge: { services: ["a", "b"] }, no_such: true },
      askedId: "gen.services",
      done: false,
    });
    expect(parsed.parseOk).toBe(true);
    expect(parsed.reply).toBe("Got it.");
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
