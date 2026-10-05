import type { TextCompleteInput, TextCompleteResult, TextPlatform } from "./types";

export type MemoryTextReply =
  | string
  | ((input: TextCompleteInput) => string | Promise<string>);

/**
 * Scripted TextPlatform for tests. Each `complete` call consumes the next reply
 * (or invokes a function). Tokens are estimated from string length.
 */
export function memoryText(replies: MemoryTextReply[] = []): TextPlatform & {
  calls: TextCompleteInput[];
  push(...next: MemoryTextReply[]): void;
} {
  const queue: MemoryTextReply[] = [...replies];
  const calls: TextCompleteInput[] = [];

  return {
    calls,
    push(...next) {
      queue.push(...next);
    },
    async complete(input) {
      calls.push(input);
      const next = queue.shift();
      if (next === undefined) throw new Error("memoryText: no scripted reply left");
      const text = typeof next === "function" ? await next(input) : next;
      const result: TextCompleteResult = {
        text,
        inputTokens: Math.ceil((input.system.length + input.messages.reduce((n, m) => n + m.content.length, 0)) / 4),
        outputTokens: Math.ceil(text.length / 4),
        model: "memory-text",
      };
      return result;
    },
  };
}
