import { describe, expect, it } from "vitest";
import { sendInviteEmail, sendMessageEmail, sendPasswordResetEmail } from "./index";

describe("job payloads", () => {
  it("accepts an invite id", () => {
    expect(sendInviteEmail.parse({ inviteId: "inv_1" })).toEqual({ inviteId: "inv_1" });
  });

  it("rejects a password reset payload without a url", () => {
    expect(() => sendPasswordResetEmail.parse({ to: "a@b.com", url: "not-a-url" })).toThrow();
  });

  it("carries only the message id for message emails, never the body", () => {
    expect(sendMessageEmail.parse({ messageId: "msg_1", recipients: ["a@b.com"] })).toEqual({
      messageId: "msg_1",
      recipients: ["a@b.com"],
    });
    expect(() => sendMessageEmail.parse({ messageId: "msg_1", recipients: ["a@b.com"], body: "secret" })).not.toThrow();
    expect(sendMessageEmail.safeParse({ messageId: "msg_1", recipients: ["a@b.com"], callerName: "Pat", body: "Hi" }).success).toBe(true);
    // Extra keys are stripped by Zod object parsing defaults — the schema has no body/callerName fields.
    expect("body" in sendMessageEmail.parse({ messageId: "msg_1", recipients: ["a@b.com"], body: "secret", callerName: "Pat" })).toBe(false);
    expect("callerName" in sendMessageEmail.parse({ messageId: "msg_1", recipients: ["a@b.com"], body: "secret", callerName: "Pat" })).toBe(false);
  });
});
