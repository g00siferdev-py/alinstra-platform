import { describe, expect, it, vi } from "vitest";

vi.mock("@alinstra/config", () => ({ getEnv: () => ({ APP_URL: "https://app.example.test/" }) }));
vi.mock("@alinstra/db", () => ({
  formatLocalTime: (value: string, timezone: string | undefined) => `local(${value}, ${timezone ?? "default"})`,
}));
vi.mock("@alinstra/email", () => ({
  sendEmail: async () => undefined,
  newSignInEmail: (input: { whenText: string; browser: string; maskedNetwork: string; securityUrl: string }) => ({
    subject: "New sign-in to your Alinstra account",
    text: `${input.whenText}|${input.browser}|${input.maskedNetwork}|${input.securityUrl}`,
  }),
}));

import { sendSignInNotice } from "./send-signin-notice";

describe("owner new sign-in email job", () => {
  it("renders the template with local time, browser, and masked network, and sends to the owner", async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    await sendSignInNotice(
      { to: "owner@example.com", at: "2026-10-06T16:30:00.000Z", browser: "Chrome on Windows", maskedNetwork: "203.0.x.x", timezone: "America/Chicago" },
      async (message) => {
        sent.push(message);
      },
    );
    expect(sent).toEqual([
      {
        to: "owner@example.com",
        subject: "New sign-in to your Alinstra account",
        text: "local(2026-10-06T16:30:00.000Z, America/Chicago)|Chrome on Windows|203.0.x.x|https://app.example.test/forgot-password",
      },
    ]);
  });

  it("lets a send failure reach BullMQ so the job retries (it never runs inside a login)", async () => {
    await expect(
      sendSignInNotice({ to: "owner@example.com", at: "2026-10-06T16:30:00.000Z", browser: "Chrome", maskedNetwork: "203.0.x.x" }, async () => {
        throw new Error("resend down");
      }),
    ).rejects.toThrow("resend down");
  });
});
