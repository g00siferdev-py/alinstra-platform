import { describe, expect, it, vi } from "vitest";
import { memoryText } from "./memory-text";
import { platformsFor } from "./local";
import { extractJsonObject, httpText, parseJsonObject } from "./text";
import { ProviderRequestError } from "./types";

describe("JSON helpers", () => {
  it("extracts the first object from prose and fences", () => {
    expect(extractJsonObject('Sure.\n```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(parseJsonObject('Here: {"reply":"hi","done":false} thanks')).toEqual({ reply: "hi", done: false });
    expect(parseJsonObject("not json")).toBeNull();
  });
});

describe("httpText", () => {
  it("posts OpenAI chat-completions shape with OpenRouter headers", async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const text = httpText({
      apiKey: "or-key-12345678",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "moonshotai/kimi-k2.5",
      fetchImpl: async (url, init) => {
        requests.push({
          url: String(url),
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"reply":"Hello","updates":{},"done":false}' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200 },
        );
      },
    });

    const result = await text.complete({
      system: "Be brief",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 256,
      json: true,
    });

    expect(result.model).toBe("moonshotai/kimi-k2.5");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(parseJsonObject(result.text)).toMatchObject({ reply: "Hello" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(requests[0]?.headers.authorization).toBe("Bearer or-key-12345678");
    expect(requests[0]?.headers["http-referer"]).toBe("https://alinstra.com");
    expect(requests[0]?.headers["x-title"]).toBe("Alinstra");
    expect(requests[0]?.body).toMatchObject({
      model: "moonshotai/kimi-k2.5",
      max_tokens: 256,
      response_format: { type: "json_object" },
    });
    const messages = requests[0]?.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("JSON object only");
  });

  it("retries 429 with backoff then succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    let hits = 0;
    const text = httpText({
      apiKey: "key-12345678",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
      sleep,
      fetchImpl: async () => {
        hits += 1;
        if (hits === 1) return new Response("rate limited", { status: 429 });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      },
    });
    const result = await text.complete({
      system: "x",
      messages: [{ role: "user", content: "y" }],
      maxTokens: 32,
    });
    expect(result.text).toBe("ok");
    expect(sleep).toHaveBeenCalled();
    expect(hits).toBe(2);
  });

  it("retries invalid JSON then uses the fallback model", async () => {
    const models: string[] = [];
    const text = httpText({
      apiKey: "key-12345678",
      baseUrl: "https://api.openai.com/v1",
      model: "primary-model",
      fallbackModel: "fallback-model",
      sleep: async () => undefined,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        models.push(body.model);
        if (body.model === "primary-model") {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: "not json at all" } }],
              usage: { prompt_tokens: 2, completion_tokens: 2 },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"reply":"fixed","updates":{},"done":false}' } }],
            usage: { prompt_tokens: 3, completion_tokens: 4 },
          }),
          { status: 200 },
        );
      },
    });
    const result = await text.complete({
      system: "json please",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 64,
      json: true,
    });
    expect(result.model).toBe("fallback-model");
    expect(parseJsonObject(result.text)).toMatchObject({ reply: "fixed" });
    expect(models.filter((m) => m === "primary-model").length).toBeGreaterThanOrEqual(2);
    expect(models).toContain("fallback-model");
  });

  it("throws ProviderRequestError on hard 400 without retrying forever", async () => {
    let hits = 0;
    const text = httpText({
      apiKey: "key-12345678",
      baseUrl: "https://api.openai.com/v1",
      fetchImpl: async () => {
        hits += 1;
        return new Response("bad request", { status: 400 });
      },
    });
    await expect(
      text.complete({ system: "x", messages: [{ role: "user", content: "y" }], maxTokens: 8 }),
    ).rejects.toBeInstanceOf(ProviderRequestError);
    expect(hits).toBe(1);
  });

  it("retries once with double max_tokens when finish_reason is length", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const text = httpText({
      apiKey: "key-12345678",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
      sleep: async () => undefined,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        if (bodies.length === 1) {
          return new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"reply":"cut off' }, finish_reason: "length" }],
              usage: { prompt_tokens: 4, completion_tokens: 8 },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: '{"reply":"complete","updates":{},"done":false}' },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 12 },
          }),
          { status: 200 },
        );
      },
    });
    const result = await text.complete({
      system: "json please",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
      json: true,
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.max_tokens).toBe(100);
    expect(bodies[1]?.max_tokens).toBe(200);
    expect(result.finishReason).toBe("stop");
    expect(parseJsonObject(result.text)).toMatchObject({ reply: "complete" });
  });

  it("sends OpenRouter reasoning.effort=low when configured", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const text = httpText({
      apiKey: "or-key-12345678",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "moonshotai/kimi-k2.5",
      reasoningEffort: "low",
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"reply":"ok","updates":{},"done":false}', reasoning: "thoughts" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      },
    });
    const result = await text.complete({
      system: "Be brief",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 64,
      json: true,
    });
    expect(bodies[0]?.reasoning).toEqual({ effort: "low" });
    expect(parseJsonObject(result.text)).toMatchObject({ reply: "ok" });
    expect(result.text).not.toContain("thoughts");
  });

  it("omits reasoning when effort is default", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const text = httpText({
      apiKey: "or-key-12345678",
      baseUrl: "https://openrouter.ai/api/v1",
      reasoningEffort: "default",
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"reply":"hi","updates":{},"done":false}' }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        );
      },
    });
    await text.complete({
      system: "Be brief",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 32,
      json: true,
    });
    expect(bodies[0]?.reasoning).toBeUndefined();
  });

  it("retries once without response_format when the provider returns 400 for json mode", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const text = httpText({
      apiKey: "key-12345678",
      baseUrl: "https://api.openai.com/v1",
      model: "provider-without-json-mode",
      sleep: async () => undefined,
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        if (body.response_format) {
          return new Response(JSON.stringify({ error: { message: "response_format not supported" } }), { status: 400 });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Sure.\n{"reply":"ok","updates":{},"done":false}' } }],
            usage: { prompt_tokens: 4, completion_tokens: 6 },
          }),
          { status: 200 },
        );
      },
    });
    const result = await text.complete({
      system: "json please",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 64,
      json: true,
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.response_format).toEqual({ type: "json_object" });
    expect(bodies[1]?.response_format).toBeUndefined();
    expect(parseJsonObject(result.text)).toMatchObject({ reply: "ok" });
  });
});

describe("memoryText + platformsFor", () => {
  it("returns scripted replies for tests", async () => {
    const fake = memoryText(['{"reply":"Next","updates":{},"done":false}']);
    const result = await fake.complete({
      system: "s",
      messages: [{ role: "user", content: "u" }],
      maxTokens: 16,
      json: true,
    });
    expect(result.text).toContain("Next");
    expect(fake.calls).toHaveLength(1);
  });

  it("exposes text only when TEXT_API_KEY is set", () => {
    const off = platformsFor({ NODE_ENV: "test", RETELL_API_KEY: "", STRIPE_SECRET_KEY: "", TEXT_API_KEY: "" });
    expect(off.text).toBeNull();
    const on = platformsFor({
      NODE_ENV: "test",
      RETELL_API_KEY: "",
      STRIPE_SECRET_KEY: "",
      TEXT_API_KEY: "sk-test",
      TEXT_API_BASE: "https://example.test/v1",
      TEXT_MODEL: "m1",
    });
    expect(on.text).not.toBeNull();
  });
});
