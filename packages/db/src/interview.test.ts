import { memoryText } from "@alinstra/providers";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./client";
import {
  discardInterviewSession,
  finishInterviewSession,
  postInterviewMessage,
  resolveTextInterviewConfig,
  saveInterviewSettings,
  startInterviewSession,
  textInterviewConfig,
} from "./interview";
import { resetTestDatabase } from "./reset-test-database";
import { startWizard } from "./wizard";

const admin = { id: "admin_interview", role: "admin" as const };

function modelJson(partial: {
  confirmation: string;
  updates?: Record<string, unknown>;
  answerStatus?: string;
}) {
  return JSON.stringify({
    confirmation: partial.confirmation,
    updates: partial.updates ?? {},
    answerStatus: partial.answerStatus ?? "answered",
    followUp: null,
  });
}

describe("interview persistence", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.user.create({
      data: {
        id: admin.id,
        name: "Admin",
        email: "admin-interview@example.com",
        emailVerified: true,
        role: "admin",
      },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("finishes by merging into the draft without overwriting admin-entered values", async () => {
    const client = await startWizard(admin, "Acme HVAC", { industry: "hvac" });
    await prisma.wizardDraft.update({
      where: { clientId: client.id },
      data: {
        payload: {
          version: 1,
          knowledge: { hours: "Admin hours 8-4", services: "" },
          voice: { assistantName: "Desk" },
          compliance: { aiDisclosure: true, recordingNotice: true },
        },
      },
    });

    const text = memoryText([
      modelJson({
        confirmation: "Thanks",
        updates: {
          knowledge: { hours: "Interview 9-5", services: "Heating and cooling" },
          voice: { assistantName: "Ava", greeting: "Thanks for calling Acme." },
        },
      }),
    ]);

    const session = await startInterviewSession(admin, {
      clientId: client.id,
      industry: "hvac",
      text,
      model: "memory-text",
    });

    await postInterviewMessage(admin, {
      sessionId: session.id,
      message: "We do heating and cooling, open 9 to 5.",
      clientMessageId: "msg-finish-1",
      text,
      budget: { inputTokens: 60_000, outputTokens: 12_000 },
    });

    const finished = await finishInterviewSession(admin, session.id);
    const payload = finished.draft.payload as {
      knowledge?: { hours?: string; services?: string };
      voice?: { assistantName?: string; greeting?: string };
    };
    expect(payload.knowledge?.hours).toBe("Admin hours 8-4");
    expect(payload.knowledge?.services).toBe("Heating and cooling");
    expect(payload.voice?.assistantName).toBe("Desk");
    expect(payload.voice?.greeting).toBe("Thanks for calling Acme.");
    expect(finished.draft.currentStep).toBe(1);
  });

  it("discard leaves the wizard draft untouched", async () => {
    const client = await startWizard(admin, "Discard Co");
    const before = await prisma.wizardDraft.findFirstOrThrow({ where: { clientId: client.id } });
    const text = memoryText([]);
    const session = await startInterviewSession(admin, {
      clientId: client.id,
      text,
      model: "memory-text",
    });
    await discardInterviewSession(admin, session.id);
    const after = await prisma.wizardDraft.findFirstOrThrow({ where: { clientId: client.id } });
    expect(after.payload).toEqual(before.payload);
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  });

  it("reports disabled when TEXT_API_KEY is absent and defaults reasoning to off", () => {
    expect(textInterviewConfig({ TEXT_API_KEY: "" }).enabled).toBe(false);
    expect(textInterviewConfig({ TEXT_API_KEY: "sk-test" }).enabled).toBe(true);
    expect(textInterviewConfig({ TEXT_API_KEY: "sk-test" }).reasoningEffort).toBe("off");
  });

  it("lets AppSetting override model while keeping the env API key", async () => {
    await saveInterviewSettings(admin, {
      textApiBase: "https://example.test/v1",
      textModel: "override/model",
      textFallbackModel: "fallback/model",
      budgetInputTokens: 12_000,
      budgetOutputTokens: 3_000,
      reasoningEffort: "low",
    });
    const resolved = await resolveTextInterviewConfig({
      TEXT_API_KEY: "sk-env-only",
      TEXT_API_BASE: "https://openrouter.ai/api/v1",
      TEXT_MODEL: "env/model",
    });
    expect(resolved.apiKey).toBe("sk-env-only");
    expect(resolved.apiBase).toBe("https://example.test/v1");
    expect(resolved.model).toBe("override/model");
    expect(resolved.fallbackModel).toBe("fallback/model");
    expect(resolved.budgetInputTokens).toBe(12_000);
    expect(resolved.reasoningEffort).toBe("low");
  });

  it("returns the same reply for a repeated clientMessageId without a second model call", async () => {
    const text = memoryText([
      modelJson({
        confirmation: "Hours captured.",
        updates: { knowledge: { hours: "Mon-Fri 9-5" } },
      }),
    ]);
    const client = await startWizard(admin, "Idempotent Co");
    const session = await startInterviewSession(admin, {
      clientId: client.id,
      text,
      model: "memory-text",
    });
    const first = await postInterviewMessage(admin, {
      sessionId: session.id,
      message: "Open 9-5",
      clientMessageId: "same-id",
      text,
      budget: { inputTokens: 60_000, outputTokens: 12_000 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(text.calls).toHaveLength(1);
    const second = await postInterviewMessage(admin, {
      sessionId: session.id,
      message: "Open 9-5",
      clientMessageId: "same-id",
      text,
      budget: { inputTokens: 60_000, outputTokens: 12_000 },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reply).toBe(first.reply);
    expect(text.calls).toHaveLength(1);
  });

  it("returns conflict when the session version is stale", async () => {
    const text = memoryText([
      modelJson({
        confirmation: "One.",
        updates: { knowledge: { hours: "9-5" } },
      }),
      modelJson({
        confirmation: "Two.",
        updates: { knowledge: { services: "lawn" } },
      }),
    ]);
    const client = await startWizard(admin, "Conflict Co");
    const session = await startInterviewSession(admin, {
      clientId: client.id,
      text,
      model: "memory-text",
    });

    // Simulate a concurrent writer bumping version after we loaded the session.
    const spy = vi.spyOn(prisma.interviewSession, "updateMany").mockResolvedValueOnce({ count: 0 });
    const result = await postInterviewMessage(admin, {
      sessionId: session.id,
      message: "Open 9-5",
      clientMessageId: "conflict-1",
      text,
      budget: { inputTokens: 60_000, outputTokens: 12_000 },
    });
    spy.mockRestore();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.conflict).toBe(true);
  });

  it("stores planCode from the client plan on start", async () => {
    const plan = await prisma.plan.create({
      data: {
        code: `solo_iv_${Date.now()}`,
        name: "Solo",
        monthlyPriceCents: 9900,
        setupFeeCents: 0,
        includedMinutes: 100,
        overagePerMinuteCents: 25,
        extraChangeFeeCents: 4900,
        recallMonthlyCents: 0,
        recallPerBookingCents: 0,
        sortOrder: 0,
        active: true,
      },
    });
    const client = await startWizard(admin, "Plan Co");
    await prisma.client.update({ where: { id: client.id }, data: { planId: plan.id } });
    const text = memoryText([]);
    const session = await startInterviewSession(admin, {
      clientId: client.id,
      text,
      model: "memory-text",
    });
    const state = session.state as { planCode?: string | null; collected?: { features?: { bookingMode?: string } } };
    expect(state.planCode).toBe(plan.code);
    expect(state.collected?.features?.bookingMode).toBe("request_only");
  });
});
