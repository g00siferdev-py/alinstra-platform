import { memoryText } from "@alinstra/providers";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
      JSON.stringify({
        reply: "Thanks",
        updates: {
          knowledge: { hours: "Interview 9-5", services: "Heating and cooling" },
          voice: { assistantName: "Ava", greeting: "Thanks for calling Acme." },
        },
        askedId: "gen.hours",
        done: false,
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

  it("reports disabled when TEXT_API_KEY is absent", () => {
    expect(textInterviewConfig({ TEXT_API_KEY: "" }).enabled).toBe(false);
    expect(textInterviewConfig({ TEXT_API_KEY: "sk-test" }).enabled).toBe(true);
  });

  it("lets AppSetting override model while keeping the env API key", async () => {
    await saveInterviewSettings(admin, {
      textApiBase: "https://example.test/v1",
      textModel: "override/model",
      textFallbackModel: "fallback/model",
      budgetInputTokens: 12_000,
      budgetOutputTokens: 3_000,
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
  });
});
