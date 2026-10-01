import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptString, encryptString } from "./index";

const key = randomBytes(32).toString("base64");

describe("encryptString", () => {
  it("round-trips a secret", () => {
    const payload = encryptString("totp-or-oauth-secret", key);
    expect(payload.startsWith("v1.")).toBe(true);
    expect(payload.includes("totp-or-oauth-secret")).toBe(false);
    expect(decryptString(payload, key)).toBe("totp-or-oauth-secret");
  });

  it("rejects a tampered payload", () => {
    const payload = encryptString("secret", key);
    const parts = payload.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptString(parts.join("."), key)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encryptString("secret", Buffer.from("short").toString("base64"))).toThrow(
      /32 bytes/,
    );
  });
});
