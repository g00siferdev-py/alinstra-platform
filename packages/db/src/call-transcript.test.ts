import { describe, expect, it } from "vitest";
import { costCentsOf, deriveOutcome, durationSecondsOf, parseTranscriptTurns, toolCallLabel, transcriptFromCall } from "./call-transcript";

const withTools = [
  { role: "agent", content: "Thank you for calling North HVAC. This is Ava.", words: [{ word: "Thank", start: 0.5, end: 0.8 }, { word: "Ava.", start: 2.1, end: 2.4 }] },
  { role: "user", content: "Hi, my furnace is out.", words: [{ word: "Hi,", start: 3.0, end: 3.2 }, { word: "out.", start: 4.4, end: 4.7 }] },
  { role: "tool_call_invocation", tool_call_id: "tc_1", name: "take_message", arguments: '{"caller_name":"Pat","callback_number":"4155550100","message":"Furnace out"}' },
  { role: "tool_call_result", tool_call_id: "tc_1", content: '{"result":"I\'ve passed that message to the office."}', successful: true },
  { role: "agent", content: "I've passed that along.", words: [] },
  { role: "node_transition", former_node_id: "a", new_node_id: "b" },
];

describe("call transcript parsing", () => {
  it("turns transcript_with_tool_calls into utterances and paired tool calls", () => {
    const turns = parseTranscriptTurns({ transcript_with_tool_calls: withTools });
    expect(turns).toHaveLength(4);
    expect(turns[0]).toEqual({ kind: "utterance", role: "agent", text: "Thank you for calling North HVAC. This is Ava.", startSeconds: 0.5, endSeconds: 2.4 });
    expect(turns[1]).toMatchObject({ kind: "utterance", role: "caller", startSeconds: 3.0, endSeconds: 4.7 });
    expect(turns[2]).toEqual({
      kind: "tool_call",
      toolCallId: "tc_1",
      name: "take_message",
      args: { caller_name: "Pat", callback_number: "4155550100", message: "Furnace out" },
      result: '{"result":"I\'ve passed that message to the office."}',
      successful: true,
    });
    expect(turns[3]).toMatchObject({ kind: "utterance", startSeconds: null, endSeconds: null });
  });

  it("falls back to transcript_object and keeps the plain text", () => {
    const transcript = transcriptFromCall({
      transcript: "Agent: Hello\nUser: Bye",
      transcript_object: [{ role: "agent", content: "Hello", words: [] }, { role: "user", content: "Bye", words: [] }],
    });
    expect(transcript?.text).toBe("Agent: Hello\nUser: Bye");
    expect(transcript?.turns.map((turn) => (turn.kind === "utterance" ? turn.role : turn.kind))).toEqual(["agent", "caller"]);
    expect(transcriptFromCall({})).toBeNull();
  });

  it("derives the outcome from tool calls and the disconnection reason", () => {
    expect(deriveOutcome(parseTranscriptTurns({ transcript_with_tool_calls: withTools }), {})).toBe("message_taken");
    const transfer = parseTranscriptTurns({
      transcript_with_tool_calls: [
        { role: "user", content: "Can I speak to billing?", words: [] },
        { role: "tool_call_invocation", tool_call_id: "t1", name: "transfer", arguments: '{"target":"Billing"}' },
        { role: "tool_call_result", tool_call_id: "t1", content: '{"allowed":true,"tool":"transfer_billing"}' },
        { role: "tool_call_invocation", tool_call_id: "t2", name: "transfer_billing", arguments: "{}" },
      ],
    });
    expect(deriveOutcome(transfer, { disconnection_reason: "call_transfer" })).toBe("transferred");
    const denied = parseTranscriptTurns({
      transcript_with_tool_calls: [
        { role: "user", content: "Can I speak to billing?", words: [] },
        { role: "tool_call_invocation", tool_call_id: "t1", name: "transfer", arguments: '{"target":"Billing"}' },
        { role: "tool_call_result", tool_call_id: "t1", content: '{"allowed":false,"reason":"closed"}' },
      ],
    });
    expect(deriveOutcome(denied, { disconnection_reason: "user_hangup" })).toBe("no_action");
    const silent = parseTranscriptTurns({ transcript_object: [{ role: "agent", content: "Hello?", words: [] }] });
    expect(deriveOutcome(silent, { disconnection_reason: "user_hangup" })).toBe("hung_up");
    const failedMessage = parseTranscriptTurns({
      transcript_with_tool_calls: [
        { role: "user", content: "Take a message", words: [] },
        { role: "tool_call_invocation", tool_call_id: "m", name: "take_message", arguments: "{}" },
        { role: "tool_call_result", tool_call_id: "m", content: '{"result":"I still need the caller\'s callback number."}' },
      ],
    });
    expect(deriveOutcome(failedMessage, {})).toBe("no_action");
  });

  it("labels tool calls for the transcript view", () => {
    const turns = parseTranscriptTurns({ transcript_with_tool_calls: withTools });
    const tool = turns.find((turn) => turn.kind === "tool_call");
    expect(tool && tool.kind === "tool_call" ? toolCallLabel(tool) : "").toBe("Took a message → sent to office");
    expect(toolCallLabel({ kind: "tool_call", toolCallId: "x", name: "transfer", args: null, result: '{"allowed":true,"tool":"transfer_billing"}', successful: null })).toBe("Checked transfer → allowed");
    expect(toolCallLabel({ kind: "tool_call", toolCallId: "x", name: "end_call", args: null, result: null, successful: null })).toBe("Ended call");
    expect(toolCallLabel({ kind: "tool_call", toolCallId: "x", name: "transfer_front_desk", args: null, result: null, successful: null })).toBe("Transferred to front desk");
  });

  it("reads cost and duration", () => {
    expect(costCentsOf({ call_cost: { combined_cost: 70.4 } })).toBe(70);
    expect(costCentsOf({})).toBeNull();
    expect(durationSecondsOf({ duration_ms: 61_400 })).toBe(61);
    expect(durationSecondsOf({ start_timestamp: 1_000, end_timestamp: 31_000 })).toBe(30);
    expect(durationSecondsOf({})).toBeNull();
  });
});
