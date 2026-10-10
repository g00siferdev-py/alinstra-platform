/** Pull complete SSE `data:` lines out of a growing buffer. The remainder may be a partial line. */
export function consumeSseBuffer(buffer: string): { rest: string; data: string[] } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const rest = lines.pop() ?? "";
  const data: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    data.push(trimmed.slice("data:".length).trim());
  }
  return { rest, data };
}

/** OpenAI-compatible chat chunk → content delta. `[DONE]` and usage-only chunks yield "". */
export function openAiContentDelta(data: string): string {
  if (!data || data === "[DONE]") return "";
  try {
    const json = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    const content = json.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

/** Confirmation string parsed so far from a partial JSON object. */
export function confirmationSoFar(partialJson: string): string {
  const key = '"confirmation"';
  const at = partialJson.indexOf(key);
  if (at < 0) return "";
  const colon = partialJson.indexOf(":", at + key.length);
  if (colon < 0) return "";
  const open = partialJson.indexOf('"', colon + 1);
  if (open < 0) return "";
  let out = "";
  for (let i = open + 1; i < partialJson.length; i += 1) {
    const ch = partialJson[i];
    if (ch === "\\") {
      const next = partialJson[i + 1];
      if (next === undefined) break;
      out += next === "n" ? "\n" : next;
      i += 1;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
  }
  return out;
}
