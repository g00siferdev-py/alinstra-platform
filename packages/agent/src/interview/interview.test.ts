import { memoryText } from "@alinstra/providers";
import { describe, expect, it } from "vitest";
import { banksFor } from "./banks";
import { interviewTurn, initialInterviewState } from "./engine";
import { contradictionQuestion, mergeIntoDraft } from "./merge";
import { validateInterviewUpdates } from "./validate";

describe("interview banks", () => {
  it("loads general plus industry extras", () => {
    expect(banksFor("general").every((item) => item.id.startsWith("gen."))).toBe(true);
    expect(banksFor("hvac").some((item) => item.id.startsWith("hvac."))).toBe(true);
    expect(banksFor("veterinary").some((item) => item.id.startsWith("vet."))).toBe(true);
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
  });

  it("rejects invalid updates and does not merge them", async () => {
    const text = memoryText([
      JSON.stringify({
        reply: "Thanks",
        updates: { features: { bookingMode: "telepathy" } },
        askedId: "gen.booking",
        done: false,
      }),
    ]);
    const state = initialInterviewState("general");
    const before = { ...state.collected };
    const result = await interviewTurn({
      state,
      userMessage: "Book however",
      text,
    });
    expect(result.state.collected).toEqual(before);
    expect(result.reply).toMatch(/rephrase|could not save|could not read/i);
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
