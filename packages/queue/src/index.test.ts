import { describe, expect, it } from "vitest";
import { sendInviteEmail, sendPasswordResetEmail } from "./index";

describe("job payloads", () => {
  it("accepts an invite id", () => {
    expect(sendInviteEmail.parse({ inviteId: "inv_1" })).toEqual({ inviteId: "inv_1" });
  });

  it("rejects a password reset payload without a url", () => {
    expect(() => sendPasswordResetEmail.parse({ to: "a@b.com", url: "not-a-url" })).toThrow();
  });
});
