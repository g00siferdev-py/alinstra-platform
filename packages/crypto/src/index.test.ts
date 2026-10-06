import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { activeKeyId, configuredKeyIds, decryptString, encryptString, encryptStringWithKey, keyIdOf, loadKeyring } from "./index";

const key = randomBytes(32).toString("base64");
const key2 = randomBytes(32).toString("base64");
const key3 = randomBytes(32).toString("base64");

/** A payload exactly as the pre-keyring code wrote it. */
function legacyV1(plaintext: string, encoded: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(encoded, "base64"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

const saved = { ...process.env };
function setEnv(values: Record<string, string | undefined>): void {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("ENCRYPTION_")) delete process.env[name];
  }
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined) process.env[name] = value;
  }
}

afterEach(() => {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("ENCRYPTION_")) delete process.env[name];
  }
  for (const [name, value] of Object.entries(saved)) {
    if (name.startsWith("ENCRYPTION_") && value !== undefined) process.env[name] = value;
  }
});

describe("encryptString with an explicit key (single-key ring)", () => {
  it("round-trips a secret and always writes v2 under k1", () => {
    const payload = encryptString("totp-or-oauth-secret", key);
    expect(payload).toMatch(/^v2\.k1\./);
    expect(payload.includes("totp-or-oauth-secret")).toBe(false);
    expect(decryptString(payload, key)).toBe("totp-or-oauth-secret");
    expect(keyIdOf(payload)).toBe("k1");
  });

  it("rejects a tampered payload", () => {
    const payload = encryptString("secret", key);
    const parts = payload.split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptString(parts.join("."), key)).toThrow();
  });

  it("rejects a tampered tag, iv, or a wrong key", () => {
    const payload = encryptString("secret", key);
    const parts = payload.split(".");
    const flipped = [...parts];
    flipped[3] = Buffer.from(randomBytes(16)).toString("base64url");
    expect(() => decryptString(flipped.join("."), key)).toThrow();
    expect(() => decryptString(payload, key2)).toThrow();
  });

  it("rejects a key that is not 32 bytes", () => {
    expect(() => encryptString("secret", Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
  });

  it("uses a fresh iv per call", () => {
    expect(encryptString("same", key)).not.toBe(encryptString("same", key));
  });
});

describe("v1 compatibility", () => {
  it("decrypts a legacy v1 payload with the explicit key", () => {
    const payload = legacyV1("old secret", key);
    expect(payload.startsWith("v1.")).toBe(true);
    expect(decryptString(payload, key)).toBe("old secret");
    expect(keyIdOf(payload)).toBe("k1");
  });

  it("decrypts v1 under k1 even when another key is active", () => {
    setEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2, ENCRYPTION_ACTIVE_KEY: "2" });
    expect(decryptString(legacyV1("old secret", key))).toBe("old secret");
  });

  it("never emits v1", () => {
    setEnv({ ENCRYPTION_KEY: key });
    expect(encryptString("x")).toMatch(/^v2\.k1\./);
  });
});

describe("keyring from env", () => {
  it("defaults the active key to k1", () => {
    setEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2 });
    expect(activeKeyId()).toBe("k1");
    expect(keyIdOf(encryptString("a"))).toBe("k1");
  });

  it("encrypts with the active key and reads every configured key", () => {
    setEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2, ENCRYPTION_KEY_V3: key3 });
    const underK1 = encryptString("one");
    setEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2, ENCRYPTION_KEY_V3: key3, ENCRYPTION_ACTIVE_KEY: "2" });
    const underK2 = encryptString("two");
    setEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2, ENCRYPTION_KEY_V3: key3, ENCRYPTION_ACTIVE_KEY: "3" });
    const underK3 = encryptString("three");
    expect([keyIdOf(underK1), keyIdOf(underK2), keyIdOf(underK3)]).toEqual(["k1", "k2", "k3"]);
    expect(underK2).toMatch(/^v2\.k2\./);
    expect(decryptString(underK1)).toBe("one");
    expect(decryptString(underK2)).toBe("two");
    expect(decryptString(underK3)).toBe("three");
    expect(configuredKeyIds()).toEqual(["k1", "k2", "k3"]);
  });

  it("accepts k2 as the active key spelling", () => {
    setEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2, ENCRYPTION_ACTIVE_KEY: "k2" });
    expect(activeKeyId()).toBe("k2");
  });

  it("ignores blank extra key variables", () => {
    setEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: "  " });
    expect(configuredKeyIds()).toEqual(["k1"]);
  });

  it("throws a clear error naming an unknown key id, never key material", () => {
    setEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2, ENCRYPTION_ACTIVE_KEY: "2" });
    const underK2 = encryptString("two");
    setEnv({ ENCRYPTION_KEY: key });
    let message = "";
    try {
      decryptString(underK2);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/k2/);
    expect(message).toMatch(/ENCRYPTION_KEY_V2/);
    expect(message).not.toContain(key);
    expect(message).not.toContain(key2);
    expect(() => decryptString(`v2.k9.${"a"}.${"b"}.${"c"}`, key)).toThrow(/k9/);
  });

  it("explicit-key calls cannot read other key ids", () => {
    setEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2, ENCRYPTION_ACTIVE_KEY: "2" });
    const underK2 = encryptString("two");
    expect(() => decryptString(underK2, key)).toThrow(/k2/);
  });
});

describe("loadKeyring validation", () => {
  it("requires ENCRYPTION_KEY", () => {
    expect(() => loadKeyring({})).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it("requires every key to be 32 bytes of base64, naming the variable", () => {
    const short = Buffer.from("short").toString("base64");
    expect(() => loadKeyring({ ENCRYPTION_KEY: short })).toThrow(/ENCRYPTION_KEY must be 32 bytes/);
    let message = "";
    try {
      loadKeyring({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: short });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/ENCRYPTION_KEY_V2 must be 32 bytes/);
    expect(message).not.toContain(short);
    expect(() => loadKeyring({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V3: "not base64 at all!!" })).toThrow(/ENCRYPTION_KEY_V3/);
  });

  it("requires the active key to exist", () => {
    expect(() => loadKeyring({ ENCRYPTION_KEY: key, ENCRYPTION_ACTIVE_KEY: "2" })).toThrow(/ENCRYPTION_ACTIVE_KEY points at k2.*ENCRYPTION_KEY_V2/);
  });

  it("rejects a malformed active key", () => {
    expect(() => loadKeyring({ ENCRYPTION_KEY: key, ENCRYPTION_ACTIVE_KEY: "abc" })).toThrow(/ENCRYPTION_ACTIVE_KEY/);
    expect(() => loadKeyring({ ENCRYPTION_KEY: key, ENCRYPTION_ACTIVE_KEY: "0" })).toThrow(/ENCRYPTION_ACTIVE_KEY/);
  });

  it("rejects two identical keys", () => {
    expect(() => loadKeyring({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key })).toThrow(/ENCRYPTION_KEY_V2 duplicates ENCRYPTION_KEY/);
    expect(() => loadKeyring({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2, ENCRYPTION_KEY_V3: key2 })).toThrow(/ENCRYPTION_KEY_V3 duplicates ENCRYPTION_KEY_V2/);
  });

  it("rejects ENCRYPTION_KEY_V1 and zero-padded ids", () => {
    expect(() => loadKeyring({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V1: key2 })).toThrow(/ENCRYPTION_KEY_V1/);
    expect(() => loadKeyring({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V02: key2 })).toThrow(/ENCRYPTION_KEY_V02/);
  });

  it("accepts a valid multi-key ring", () => {
    const ring = loadKeyring({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2, ENCRYPTION_ACTIVE_KEY: "2" });
    expect([...ring.keys.keys()]).toEqual(["k1", "k2"]);
    expect(ring.activeId).toBe("k2");
  });
});

describe("encryptStringWithKey", () => {
  it("encrypts under the named key regardless of the active key", () => {
    setEnv({ ENCRYPTION_KEY: key, ENCRYPTION_KEY_V2: key2 });
    const payload = encryptStringWithKey("moved", "k2");
    expect(keyIdOf(payload)).toBe("k2");
    expect(decryptString(payload)).toBe("moved");
    expect(keyIdOf(encryptStringWithKey("stay", "k1"))).toBe("k1");
  });

  it("rejects an unconfigured or malformed key id", () => {
    setEnv({ ENCRYPTION_KEY: key });
    expect(() => encryptStringWithKey("x", "k2")).toThrow(/Unknown encryption key id k2/);
    expect(() => encryptStringWithKey("x", "two")).toThrow(/Invalid encryption key id/);
  });
});

describe("keyIdOf and format errors", () => {
  it("rejects unknown formats", () => {
    expect(() => keyIdOf("v3.a.b.c")).toThrow(/Unknown ciphertext format/);
    expect(() => keyIdOf("v2.notakey.a.b.c")).toThrow(/Unknown ciphertext format/);
    expect(() => keyIdOf("v2.k1.a.b")).toThrow(/Unknown ciphertext format/);
    expect(() => keyIdOf("plaintext")).toThrow(/Unknown ciphertext format/);
    expect(() => decryptString("v1.a.b", key)).toThrow(/Unknown ciphertext format/);
    expect(() => decryptString("nope", key)).toThrow(/Unknown ciphertext format/);
  });
});
