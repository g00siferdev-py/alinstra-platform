/**
 * Pure helpers for Retell call payloads: turning `transcript_with_tool_calls` into our structured
 * turn array, and deriving a call outcome from it. No database access, so the nightly call-review
 * reader planned for Phase 8 can use the same shapes.
 *
 * Field names follow https://docs.retellai.com/api-references/get-call (Utterance,
 * ToolCallInvocationUtterance, ToolCallResultUtterance, CallAnalysis, call_cost).
 */

export type CallTurn =
  | {
      kind: "utterance";
      role: "agent" | "caller" | "transfer_target";
      text: string;
      startSeconds: number | null;
      endSeconds: number | null;
    }
  | {
      kind: "tool_call";
      toolCallId: string;
      name: string;
      args: Record<string, unknown> | string | null;
      result: string | null;
      successful: boolean | null;
    };

export type CallTranscript = { version: 1; text: string; turns: CallTurn[] };

export const CALL_OUTCOMES = ["message_taken", "transferred", "booked", "no_action", "hung_up"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  message_taken: "Message taken",
  transferred: "Transferred",
  booked: "Booked",
  no_action: "No action",
  hung_up: "Hung up",
};

export const SENTIMENTS = ["Positive", "Neutral", "Negative", "Unknown"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/** The subset of the Retell call object this module reads. Everything is optional; events arrive in pieces. */
export type RetellCallFields = {
  call_id?: string;
  agent_id?: string;
  from_number?: string;
  to_number?: string;
  direction?: string;
  start_timestamp?: number;
  end_timestamp?: number;
  duration_ms?: number;
  disconnection_reason?: string;
  transcript?: string;
  transcript_object?: unknown;
  transcript_with_tool_calls?: unknown;
  recording_url?: string;
  call_analysis?: {
    call_summary?: string;
    in_voicemail?: boolean;
    user_sentiment?: string;
    call_successful?: boolean;
  };
  call_cost?: { combined_cost?: number };
};

export type RetellCallEvent = { event?: string; call?: RetellCallFields };

export const RETELL_CALL_EVENTS = ["call_started", "call_ended", "call_analyzed"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function wordBounds(words: unknown): { start: number | null; end: number | null } {
  if (!Array.isArray(words) || words.length === 0) return { start: null, end: null };
  const first = asRecord(words[0]);
  const last = asRecord(words[words.length - 1]);
  return { start: numberOrNull(first?.start), end: numberOrNull(last?.end) };
}

function parseArgs(value: unknown): Record<string, unknown> | string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return asRecord(parsed) ?? value;
    } catch {
      return value;
    }
  }
  return asRecord(value) ?? String(value);
}

/**
 * Builds the turn array from `transcript_with_tool_calls` (preferred) or `transcript_object`.
 * Tool results are folded into their invocation by `tool_call_id`. Unknown roles are dropped.
 */
export function parseTranscriptTurns(call: Pick<RetellCallFields, "transcript_object" | "transcript_with_tool_calls">): CallTurn[] {
  const source = Array.isArray(call.transcript_with_tool_calls)
    ? call.transcript_with_tool_calls
    : Array.isArray(call.transcript_object)
      ? call.transcript_object
      : [];
  const turns: CallTurn[] = [];
  const invocations = new Map<string, Extract<CallTurn, { kind: "tool_call" }>>();
  for (const item of source) {
    const row = asRecord(item);
    if (!row) continue;
    const role = row.role;
    if (role === "agent" || role === "user" || role === "transfer_target") {
      const bounds = wordBounds(row.words);
      turns.push({
        kind: "utterance",
        role: role === "user" ? "caller" : role,
        text: typeof row.content === "string" ? row.content : "",
        startSeconds: bounds.start,
        endSeconds: bounds.end,
      });
      continue;
    }
    if (role === "tool_call_invocation") {
      const turn: Extract<CallTurn, { kind: "tool_call" }> = {
        kind: "tool_call",
        toolCallId: typeof row.tool_call_id === "string" ? row.tool_call_id : "",
        name: typeof row.name === "string" ? row.name : "unknown",
        args: parseArgs(row.arguments),
        result: null,
        successful: null,
      };
      turns.push(turn);
      if (turn.toolCallId) invocations.set(turn.toolCallId, turn);
      continue;
    }
    if (role === "tool_call_result") {
      const id = typeof row.tool_call_id === "string" ? row.tool_call_id : "";
      const content = typeof row.content === "string" ? row.content : row.content === undefined ? null : JSON.stringify(row.content);
      const successful = typeof row.successful === "boolean" ? row.successful : null;
      const invocation = id ? invocations.get(id) : undefined;
      if (invocation) {
        invocation.result = content;
        invocation.successful = successful;
      } else {
        turns.push({ kind: "tool_call", toolCallId: id, name: "result", args: null, result: content, successful });
      }
    }
  }
  return turns;
}

export function transcriptFromCall(call: RetellCallFields): CallTranscript | null {
  const turns = parseTranscriptTurns(call);
  const text = typeof call.transcript === "string" ? call.transcript : "";
  if (turns.length === 0 && !text.trim()) return null;
  return { version: 1, text, turns };
}

function toolResultText(turn: Extract<CallTurn, { kind: "tool_call" }>): string {
  if (!turn.result) return "";
  try {
    const parsed = JSON.parse(turn.result) as unknown;
    const record = asRecord(parsed);
    if (record && typeof record.result === "string") return record.result;
    if (record && typeof record.reason === "string") return record.reason;
  } catch {
    // Plain text result.
  }
  return turn.result;
}

function messageWasSaved(turn: Extract<CallTurn, { kind: "tool_call" }>): boolean {
  if (turn.successful === false) return false;
  const text = toolResultText(turn);
  return !/still need|could not save|try again/i.test(text);
}

function transferAllowed(turn: Extract<CallTurn, { kind: "tool_call" }>): boolean {
  if (turn.successful === false) return false;
  if (!turn.result) return true;
  try {
    const parsed = asRecord(JSON.parse(turn.result) as unknown);
    if (parsed && "allowed" in parsed) return parsed.allowed === true;
  } catch {
    // Not JSON; a built-in transfer_call tool reports no body.
  }
  return true;
}

/**
 * Outcome from the turns, in priority order: a saved message, a completed transfer, a booking,
 * then whether the caller ever spoke. `call_transfer` as the disconnection reason also counts as transferred.
 */
export function deriveOutcome(turns: CallTurn[], call: Pick<RetellCallFields, "disconnection_reason">): CallOutcome {
  const tools = turns.filter((turn): turn is Extract<CallTurn, { kind: "tool_call" }> => turn.kind === "tool_call");
  if (tools.some((turn) => turn.name === "take_message" && messageWasSaved(turn))) return "message_taken";
  if (call.disconnection_reason === "call_transfer") return "transferred";
  if (tools.some((turn) => turn.name.startsWith("transfer_") && turn.name !== "transfer_check" && transferAllowed(turn))) return "transferred";
  if (tools.some((turn) => /^book/i.test(turn.name) && turn.successful !== false)) return "booked";
  const callerSpoke = turns.some((turn) => turn.kind === "utterance" && turn.role === "caller" && turn.text.trim() !== "");
  return callerSpoke ? "no_action" : "hung_up";
}

/** Human line for a tool invocation in the transcript view. */
export function toolCallLabel(turn: Extract<CallTurn, { kind: "tool_call" }>): string {
  if (turn.name === "take_message") return messageWasSaved(turn) ? "Took a message → sent to office" : `Tried to take a message → ${toolResultText(turn) || "not saved"}`;
  if (turn.name === "transfer") return `Checked transfer → ${transferAllowed(turn) ? "allowed" : "not allowed"}`;
  if (turn.name.startsWith("transfer_")) return `Transferred to ${turn.name.slice("transfer_".length).replace(/_/g, " ")}`;
  if (turn.name === "end_call") return "Ended call";
  if (/^book/i.test(turn.name)) return "Booked an appointment";
  return `Called ${turn.name}`;
}

export function normalizeSentiment(value: unknown): Sentiment | null {
  return typeof value === "string" && (SENTIMENTS as readonly string[]).includes(value) ? (value as Sentiment) : null;
}

/** Retell reports `combined_cost` in cents as a float. */
export function costCentsOf(call: Pick<RetellCallFields, "call_cost">): number | null {
  const value = call.call_cost?.combined_cost;
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

export function durationSecondsOf(call: Pick<RetellCallFields, "start_timestamp" | "end_timestamp" | "duration_ms">): number | null {
  if (typeof call.duration_ms === "number" && Number.isFinite(call.duration_ms)) return Math.max(0, Math.round(call.duration_ms / 1000));
  if (typeof call.start_timestamp === "number" && typeof call.end_timestamp === "number") {
    return Math.max(0, Math.round((call.end_timestamp - call.start_timestamp) / 1000));
  }
  return null;
}
