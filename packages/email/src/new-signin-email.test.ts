import { describe, expect, it } from "vitest";
import { newSignInEmail } from "./index";

describe("newSignInEmail", () => {
  it("shows time, browser, and the masked network, and links to a password reset", () => {
    const message = newSignInEmail({
      whenText: "Oct 6, 11:30 AM",
      browser: "Chrome on Windows",
      maskedNetwork: "203.0.x.x",
      securityUrl: "https://app.example.test/forgot-password",
    });
    expect(message.subject).toBe("New sign-in to your Alinstra account");
    expect(message.text).toContain("When: Oct 6, 11:30 AM");
    expect(message.text).toContain("Browser: Chrome on Windows");
    expect(message.text).toContain("Network: 203.0.x.x");
    expect(message.text).toContain("https://app.example.test/forgot-password");
    expect(message.text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});
