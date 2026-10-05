import {
  DEFAULT_TEXT_API_BASE,
  DEFAULT_TEXT_MODEL,
  ProviderRequestError,
  type TextCompleteInput,
  type TextCompleteResult,
  type TextPlatform,
} from "./types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export type HttpTextOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fallbackModel?: string;
  /**
   * OpenRouter reasoning effort. `default` omits the field; `low` / `off` send
   * `reasoning: { effort: "low" | "none" }`. Ignored for non-OpenRouter bases.
   */
  reasoningEffort?: "off" | "low" | "default";
  fetchImpl?: FetchLike;
  /** Injected for tests; defaults to real wall clock. */
  sleep?: (ms: number) => Promise<void>;
};

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, "");
}

function isOpenRouter(base: string): boolean {
  try {
    return new URL(base).hostname.endsWith("openrouter.ai");
  } catch {
    return base.includes("openrouter.ai");
  }
}

function redactSecrets(value: string, secrets: string[]): string {
  let out = value.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  return out;
}

/** First top-level `{...}` block in a string, respecting quotes and escapes. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const extracted = extractJsonObject(trimmed);
  if (extracted && extracted !== trimmed) candidates.push(extracted);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next
    }
  }
  return null;
}

function usageTokens(body: Record<string, unknown>): { inputTokens: number; outputTokens: number } {
  const usage = body.usage;
  if (!usage || typeof usage !== "object") return { inputTokens: 0, outputTokens: 0 };
  const row = usage as Record<string, unknown>;
  const input = Number(row.prompt_tokens ?? row.input_tokens ?? 0);
  const output = Number(row.completion_tokens ?? row.output_tokens ?? 0);
  return {
    inputTokens: Number.isFinite(input) ? Math.max(0, Math.round(input)) : 0,
    outputTokens: Number.isFinite(output) ? Math.max(0, Math.round(output)) : 0,
  };
}

function choiceText(body: Record<string, unknown>): string {
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  // Only message.content — never a sibling reasoning field.
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function choiceFinishReason(body: Record<string, unknown>): string | null {
  const choices = body.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as Record<string, unknown> | undefined;
  return typeof first?.finish_reason === "string" ? first.finish_reason : null;
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * OpenAI chat-completions client. Works against OpenRouter, Ollama Cloud, OpenAI,
 * and Anthropic's OpenAI-compatible endpoint with the same request shape.
 * Never logs prompt or response content.
 */
export function httpText(options: HttpTextOptions): TextPlatform {
  const apiKey = options.apiKey;
  const baseUrl = normalizeBase(options.baseUrl?.trim() || DEFAULT_TEXT_API_BASE);
  const primaryModel = options.model?.trim() || DEFAULT_TEXT_MODEL;
  const fallbackModel = options.fallbackModel?.trim() || "";
  const reasoningEffort = options.reasoningEffort ?? "default";
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const openRouter = isOpenRouter(baseUrl);

  async function postOnce(
    model: string,
    messages: { role: string; content: string }[],
    maxTokens: number,
    json: boolean,
  ): Promise<TextCompleteResult> {
    const url = `${baseUrl}/chat/completions`;
    let lastError: Error | null = null;
    let omitResponseFormat = false;
    let tokensBudget = maxTokens;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const headers: Record<string, string> = {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        };
        if (openRouter) {
          headers["HTTP-Referer"] = "https://alinstra.com";
          headers["X-Title"] = "Alinstra";
        }

        const body: Record<string, unknown> = {
          model,
          messages,
          max_tokens: tokensBudget,
          temperature: 0.4,
        };
        if (json && !omitResponseFormat) body.response_format = { type: "json_object" };
        if (openRouter && reasoningEffort === "low") body.reasoning = { effort: "low" };
        if (openRouter && reasoningEffort === "off") body.reasoning = { effort: "none" };

        const response = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const text = await response.text();
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = text ? (JSON.parse(text) as Record<string, unknown>) : null;
        } catch {
          parsed = null;
        }

        // Some providers (or models) reject response_format; retry once without it and extract JSON from prose.
        if (json && !omitResponseFormat && response.status === 400) {
          omitResponseFormat = true;
          continue;
        }

        if (RETRYABLE.has(response.status) && attempt < MAX_RETRIES - 1) {
          await sleep(250 * 2 ** attempt);
          continue;
        }

        if (!response.ok) {
          const detail = redactSecrets(text.slice(0, 300), [apiKey]) || "empty response";
          throw new ProviderRequestError(`Text API request failed (${response.status}): ${detail}`, response.status);
        }

        const content = choiceText(parsed ?? {});
        const finishReason = choiceFinishReason(parsed ?? {});
        const tokens = usageTokens(parsed ?? {});

        // Truncated JSON: retry once with double max_tokens (cap 4000).
        if (finishReason === "length" && tokensBudget < 4000 && tokensBudget === maxTokens) {
          tokensBudget = Math.min(maxTokens * 2, 4000);
          continue;
        }

        return {
          text: content,
          inputTokens: tokens.inputTokens,
          outputTokens: tokens.outputTokens,
          model,
          finishReason,
        };
      } catch (error) {
        if (error instanceof ProviderRequestError) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
        if (lastError.name === "AbortError") {
          throw new ProviderRequestError("Text API request timed out", 408);
        }
        if (attempt < MAX_RETRIES - 1) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new ProviderRequestError("Text API request failed", 500);
  }

  async function completeWithJsonRetries(
    model: string,
    system: string,
    messages: TextCompleteInput["messages"],
    maxTokens: number,
  ): Promise<TextCompleteResult> {
    let chat = [{ role: "system", content: system }, ...messages];
    let totalIn = 0;
    let totalOut = 0;
    let lastText = "";
    let lastFinish: string | null | undefined;
    let invalidStreak = 0;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await postOnce(model, chat, maxTokens, true);
      totalIn += result.inputTokens;
      totalOut += result.outputTokens;
      lastText = result.text;
      lastFinish = result.finishReason;
      if (parseJsonObject(result.text)) {
        return {
          text: result.text,
          inputTokens: totalIn,
          outputTokens: totalOut,
          model,
          finishReason: result.finishReason,
        };
      }
      invalidStreak += 1;
      chat = [
        ...chat,
        { role: "assistant", content: result.text || "(empty)" },
        { role: "user", content: "Your previous reply was not valid JSON. Return only a single JSON object, no markdown or prose." },
      ];
    }

    if (fallbackModel && fallbackModel !== model && invalidStreak >= 2) {
      const result = await postOnce(fallbackModel, chat, maxTokens, true);
      totalIn += result.inputTokens;
      totalOut += result.outputTokens;
      if (parseJsonObject(result.text)) {
        return {
          text: result.text,
          inputTokens: totalIn,
          outputTokens: totalOut,
          model: fallbackModel,
          finishReason: result.finishReason,
        };
      }
      lastText = result.text;
      return {
        text: lastText,
        inputTokens: totalIn,
        outputTokens: totalOut,
        model: fallbackModel,
        finishReason: result.finishReason,
      };
    }

    return { text: lastText, inputTokens: totalIn, outputTokens: totalOut, model, finishReason: lastFinish };
  }

  return {
    async complete(input) {
      const system = input.json
        ? `${input.system}\n\nRespond with a single JSON object only. No markdown fences, no commentary.`
        : input.system;
      const messages = input.messages;

      if (!input.json) {
        try {
          return await postOnce(primaryModel, [{ role: "system", content: system }, ...messages], input.maxTokens, false);
        } catch (error) {
          if (fallbackModel && error instanceof ProviderRequestError) {
            return postOnce(fallbackModel, [{ role: "system", content: system }, ...messages], input.maxTokens, false);
          }
          throw error;
        }
      }

      try {
        const result = await completeWithJsonRetries(primaryModel, system, messages, input.maxTokens);
        if (parseJsonObject(result.text)) return result;
        if (fallbackModel && fallbackModel !== primaryModel && result.model === primaryModel) {
          return completeWithJsonRetries(fallbackModel, system, messages, input.maxTokens);
        }
        return result;
      } catch (error) {
        if (fallbackModel && error instanceof ProviderRequestError) {
          return completeWithJsonRetries(fallbackModel, system, messages, input.maxTokens);
        }
        throw error;
      }
    },
  };
}
