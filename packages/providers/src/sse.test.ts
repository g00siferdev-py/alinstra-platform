import { describe, expect, it } from "vitest";
import { confirmationSoFar, consumeSseBuffer, openAiContentDelta } from "./sse";

describe("OpenAI SSE parser", () => {
  it("joins split chunks into content deltas and ignores the done marker", () => {
    const first = 'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choi';
    const pulled = consumeSseBuffer(first);
    expect(openAiContentDelta(pulled.data[0]!)).toBe("Hi");
    expect(pulled.rest).toContain("choi");
    const rest = consumeSseBuffer(`${pulled.rest}ces":[{"delta":{"content":"!"}}]}\n\ndata: [DONE]\n`);
    expect(openAiContentDelta(rest.data[0]!)).toBe("!");
    expect(openAiContentDelta(rest.data[1]!)).toBe("");
  });

  it("emits only the new confirmation characters", () => {
    const partial = '{"confirmation":"Got';
    const more = '{"confirmation":"Got it."';
    const before = confirmationSoFar(partial);
    const after = confirmationSoFar(more);
    expect(before).toBe("Got");
    expect(after.slice(before.length)).toBe(" it.");
  });
});
