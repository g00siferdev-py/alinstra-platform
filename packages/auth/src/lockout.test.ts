import { beforeEach, describe, expect, it } from "vitest";
import { ACCOUNT_LOGIN_LOCKOUT, LOGIN_LOCKOUT } from "./constants";
import { resetMemoryCounter } from "./counter";
import { handleAuthRequest } from "./handler";
import { clientIp, loginLocked, recordLoginFailure } from "./lockout";

describe("clientIp", () => {
  it("ignores a spoofed leftmost X-Forwarded-For entry", () => {
    const request = new Request("http://localhost/api/auth/sign-in/email", {
      headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.8" },
    });
    expect(clientIp(request)).toBe("203.0.113.8");
  });

  it("prefers Railway X-Real-IP over a spoofed forwarded chain", () => {
    const request = new Request("http://localhost/api/auth/sign-in/email", {
      headers: {
        "x-forwarded-for": "1.1.1.1, 203.0.113.8",
        "x-real-ip": "198.51.100.10",
      },
    });
    expect(clientIp(request)).toBe("198.51.100.10");
  });

  it("skips the configured number of trusted proxy hops from the right", () => {
    const request = new Request("http://localhost/api/auth/sign-in/email", {
      headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.8, 192.0.2.1" },
    });
    expect(clientIp(request, 2)).toBe("203.0.113.8");
  });
});

describe("account lockout", () => {
  beforeEach(() => {
    resetMemoryCounter();
  });

  it("locks the account after 20 failures even when each attempt uses a new IP", async () => {
    const email = "person@example.com";
    for (let attempt = 0; attempt < ACCOUNT_LOGIN_LOCKOUT.maxFailures; attempt += 1) {
      expect(await loginLocked(email, `203.0.113.${attempt}`)).toBe(false);
      await recordLoginFailure(email, `203.0.113.${attempt}`);
    }
    expect(await loginLocked(email, "198.51.100.50")).toBe(true);
  });
});

describe("sign-in email parsing", () => {
  beforeEach(() => {
    resetMemoryCounter();
  });

  it("returns 400 when the email cannot be read from JSON or a form body", async () => {
    const json = await handleAuthRequest(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(json.status).toBe(400);

    const broken = await handleAuthRequest(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(broken.status).toBe(400);

    const form = await handleAuthRequest(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "password=not-the-email",
      }),
    );
    expect(form.status).toBe(400);
  });

  it("locks using the trusted IP when X-Forwarded-For is spoofed", async () => {
    const email = "person@example.com";
    const ip = "203.0.113.8";
    for (let attempt = 0; attempt < LOGIN_LOCKOUT.maxFailures; attempt += 1) {
      await recordLoginFailure(email, ip);
    }
    const response = await handleAuthRequest(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-forwarded-for": "1.1.1.1, 203.0.113.8",
        },
        body: "email=person%40example.com&password=wrong-password-value",
      }),
    );
    expect(response.status).toBe(429);
  });
});
