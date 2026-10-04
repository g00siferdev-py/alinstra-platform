import { describe, expect, it } from "vitest";
import { httpVoice } from "./http";
import { MemoryVoice } from "./memory";
import { CALL_TIMING_DEFAULTS, END_CALL_TOOL, retellTiming } from "./types";

describe("call timing", () => {
  it("maps the configured values onto Retell fields with a single reminder", () => {
    expect(retellTiming({ maxCallMinutes: 15, silenceSeconds: 30, reminderSeconds: 8 })).toEqual({
      max_call_duration_ms: 900_000,
      end_call_after_silence_ms: 30_000,
      reminder_trigger_ms: 8_000,
      reminder_max_count: 1,
    });
  });

  it("applies the defaults when no timing is configured", () => {
    const expected = retellTiming(CALL_TIMING_DEFAULTS);
    expect(retellTiming(undefined)).toEqual(expected);
    expect(retellTiming(null)).toEqual(expected);
    expect(retellTiming({})).toEqual(expected);
    expect(expected.max_call_duration_ms).toBe(15 * 60_000);
  });

  it("clamps out-of-range values to Retell's hard limits", () => {
    const low = retellTiming({ maxCallMinutes: 0, silenceSeconds: 2, reminderSeconds: 0 });
    expect(low.max_call_duration_ms).toBe(60_000);
    expect(low.end_call_after_silence_ms).toBe(10_000);
    expect(low.reminder_trigger_ms).toBe(1_000);
    const high = retellTiming({ maxCallMinutes: 999, silenceSeconds: 99_999, reminderSeconds: 99_999 });
    expect(high.max_call_duration_ms).toBe(7_200_000);
    expect(high.end_call_after_silence_ms).toBe(3_600_000);
    expect(high.reminder_trigger_ms).toBe(600_000);
    expect(retellTiming({ maxCallMinutes: Number.NaN }).max_call_duration_ms).toBe(60_000);
  });

  it("stores the clamped timing on the in-memory agent at create and sync", async () => {
    const voice = new MemoryVoice();
    const { llmId } = await voice.createLlm({ clientId: "c1", prompt: "Hi", beginMessage: "Hello", tools: [END_CALL_TOOL] });
    const { agentId } = await voice.createAgent({ clientId: "c1", llmId, voiceId: "retell-Brynne", webhookUrl: "https://x.test/hook", timing: { maxCallMinutes: 20, silenceSeconds: 45, reminderSeconds: 10 } });
    expect(voice.agents.get(agentId)?.timing).toEqual({ max_call_duration_ms: 1_200_000, end_call_after_silence_ms: 45_000, reminder_trigger_ms: 10_000, reminder_max_count: 1 });
    await voice.syncAgent({ clientId: "c1", llmId, agentId, prompt: "Hi", beginMessage: "Hello", voiceId: "retell-Brynne", tools: [END_CALL_TOOL], webhookUrl: "https://x.test/hook", inboundWebhookUrl: "https://x.test/in" });
    expect(voice.agents.get(agentId)?.timing).toEqual(retellTiming(CALL_TIMING_DEFAULTS));
  });

  it("sends timing fields and the end_call tool in the HTTP payloads", async () => {
    const bodies: Array<{ url: string; json: Record<string, unknown> }> = [];
    const voice = httpVoice("test-key", async (url, init) => {
      if (init?.body) bodies.push({ url: String(url), json: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (String(url).includes("/get-agent/")) return new Response(JSON.stringify({ version: 1, is_published: false }), { status: 200 });
      return new Response(JSON.stringify({ llm_id: "llm_test", agent_id: "agent_test", version: 1 }), { status: 200 });
    });
    await voice.createLlm({ clientId: "c1", prompt: "Hi", beginMessage: "Hello", tools: [END_CALL_TOOL] });
    await voice.createAgent({ clientId: "c1", llmId: "llm_test", voiceId: "retell-Brynne", webhookUrl: "https://x.test/hook", timing: { maxCallMinutes: 5, silenceSeconds: 20, reminderSeconds: 6 } });
    await voice.syncAgent({ clientId: "c1", llmId: "llm_test", agentId: "agent_test", prompt: "Hi", beginMessage: "Hello", voiceId: "retell-Brynne", tools: [END_CALL_TOOL], webhookUrl: "https://x.test/hook", inboundWebhookUrl: "https://x.test/in", timing: { maxCallMinutes: 5, silenceSeconds: 20, reminderSeconds: 6 } });
    const created = bodies.find((entry) => entry.url.endsWith("/create-agent"))?.json;
    const updated = bodies.find((entry) => entry.url.includes("/update-agent/"))?.json;
    for (const body of [created, updated]) {
      expect(body).toMatchObject({ max_call_duration_ms: 300_000, end_call_after_silence_ms: 20_000, reminder_trigger_ms: 6_000, reminder_max_count: 1 });
    }
    const llm = bodies.find((entry) => entry.url.endsWith("/create-retell-llm"))?.json;
    expect(llm?.general_tools).toEqual([{ type: "end_call", name: "end_call", description: END_CALL_TOOL.description }]);
  });
});
