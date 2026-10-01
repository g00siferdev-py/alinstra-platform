import { describe, expect, it } from "vitest";
import { scrubSentryEvent } from "./log";

describe("scrubSentryEvent", () => {
  it("drops bodies, emails, phones, and transcripts", () => {
    const event = scrubSentryEvent({
      request: {
        data: { email: "a@b.com", transcript: "hello", phone: "555" },
        cookies: { session: "abc" },
        query_string: "email=a@b.com",
        headers: { authorization: "Bearer x", "content-type": "application/json" },
      },
      user: { id: "user_1", email: "a@b.com", ip_address: "1.1.1.1", username: "Ada" },
      extra: { phone: "555", note: "ok" },
      breadcrumbs: [{ message: "posted transcript", data: { email: "a@b.com" } }],
    });

    expect(event.request?.data).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers?.authorization).toBeUndefined();
    expect(event.request?.headers?.["content-type"]).toBe("application/json");
    expect(event.user?.email).toBeUndefined();
    expect(event.user?.id).toBe("user_1");
    expect(event.extra?.phone).toBe("[redacted]");
    expect(event.extra?.note).toBe("ok");
    expect(event.breadcrumbs?.[0]?.message).toBe("[redacted]");
    expect(event.breadcrumbs?.[0]?.data?.email).toBe("[redacted]");
  });
});
