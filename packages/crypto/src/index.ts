import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM with a versioned keyring.
 *
 * Payload formats (all segments base64url):
 * - v1: `v1.<iv>.<tag>.<ciphertext>`; legacy, always key `k1`. Read forever, never written.
 * - v2: `v2.<keyId>.<iv>.<tag>.<ciphertext>`; every new write. `keyId` is `k1`, `k2`, ...
 *
 * Keys come from env: `k1` = ENCRYPTION_KEY; `kN` = ENCRYPTION_KEY_V<N> for N >= 2.
 * ENCRYPTION_ACTIVE_KEY (default "1") picks the key used for new encryptions.
 * Errors name the env var or key id, never the key material.
 */

const V1 = "v1";
const V2 = "v2";
const KEY_ID_PATTERN = /^k[1-9]\d*$/;
const EXTRA_KEY_VAR = /^ENCRYPTION_KEY_V(\d+)$/;

export type Keyring = {
  /** Key id (`k1`, `k2`, ...) to raw 32-byte key. */
  keys: ReadonlyMap<string, Buffer>;
  /** Key id used for new encryptions. */
  activeId: string;
};

type EnvLike = Readonly<Record<string, string | undefined>>;

function envVarFor(keyId: string): string {
  return keyId === "k1" ? "ENCRYPTION_KEY" : `ENCRYPTION_KEY_V${keyId.slice(1)}`;
}

function decodeKey(encoded: string, label: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error(`${label} must be 32 bytes, base64-encoded`);
  }
  return key;
}

function parseActiveId(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "k1";
  const match = /^k?([1-9]\d*)$/.exec(value);
  if (!match) throw new Error("ENCRYPTION_ACTIVE_KEY must be a positive integer such as 1 or 2");
  return `k${match[1]}`;
}

/**
 * Builds the keyring from env and validates it. Fails fast, in this order:
 * missing k1, a key that is not 32 bytes of base64, an ambiguous ENCRYPTION_KEY_V1, duplicate keys,
 * an active key that is not configured.
 */
export function loadKeyring(env: EnvLike = process.env): Keyring {
  const k1 = env.ENCRYPTION_KEY;
  if (!k1) throw new Error("ENCRYPTION_KEY is not set");
  const keys = new Map<string, Buffer>();
  keys.set("k1", decodeKey(k1, "ENCRYPTION_KEY"));

  const extra: Array<{ n: number; name: string; value: string }> = [];
  for (const [name, value] of Object.entries(env)) {
    const match = EXTRA_KEY_VAR.exec(name);
    if (!match || value === undefined || value.trim() === "") continue;
    const n = Number(match[1]);
    if (!Number.isSafeInteger(n) || n < 2 || match[1] !== String(n)) {
      throw new Error(`${name} is not a valid key variable; use ENCRYPTION_KEY for k1 and ENCRYPTION_KEY_V2, V3, ... for the rest`);
    }
    extra.push({ n, name, value });
  }
  extra.sort((a, b) => a.n - b.n);
  for (const entry of extra) keys.set(`k${entry.n}`, decodeKey(entry.value, entry.name));

  const seen = new Map<string, string>();
  for (const [id, key] of keys) {
    const fingerprint = key.toString("hex");
    const other = seen.get(fingerprint);
    if (other) throw new Error(`${envVarFor(id)} duplicates ${envVarFor(other)}; every encryption key must be distinct`);
    seen.set(fingerprint, id);
  }

  const activeId = parseActiveId(env.ENCRYPTION_ACTIVE_KEY);
  if (!keys.has(activeId)) {
    throw new Error(`ENCRYPTION_ACTIVE_KEY points at ${activeId}, but ${envVarFor(activeId)} is not set`);
  }
  return { keys, activeId };
}

/** A ring holding only `k1`: the pre-keyring call shape, `encryptString(value, key)`. */
function singleKeyRing(encodedKey: string): Keyring {
  return { keys: new Map([["k1", decodeKey(encodedKey, "ENCRYPTION_KEY")]]), activeId: "k1" };
}

function ringFor(encodedKey: string | undefined): Keyring {
  return encodedKey === undefined ? loadKeyring() : singleKeyRing(encodedKey);
}

function keyFor(ring: Keyring, keyId: string): Buffer {
  const key = ring.keys.get(keyId);
  if (!key) throw new Error(`Unknown encryption key id ${keyId}; set ${envVarFor(keyId)}`);
  return key;
}

/** Key ids configured in env, `k1` first. */
export function configuredKeyIds(env: EnvLike = process.env): string[] {
  return [...loadKeyring(env).keys.keys()];
}

/** The key id new encryptions use. */
export function activeKeyId(env: EnvLike = process.env): string {
  return loadKeyring(env).activeId;
}

/**
 * Encrypts with the active key and always emits v2: `v2.<keyId>.<iv>.<tag>.<ciphertext>`.
 * Without `encodedKey` the keyring is read from env. With it, the string is treated as a single-key
 * ring (`k1`), which keeps older call sites and tests working.
 */
export function encryptString(plaintext: string, encodedKey?: string): string {
  const ring = ringFor(encodedKey);
  return encryptWith(ring, ring.activeId, plaintext);
}

/** Encrypts under a specific configured key id (`k2`), whatever the active key is. Used by key rotation. */
export function encryptStringWithKey(plaintext: string, keyId: string, env: EnvLike = process.env): string {
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error(`Invalid encryption key id ${keyId}; use k1, k2, ...`);
  return encryptWith(loadKeyring(env), keyId, plaintext);
}

function encryptWith(ring: Keyring, keyId: string, plaintext: string): string {
  const key = keyFor(ring, keyId);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [V2, keyId, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Reads v1 (always `k1`) and v2 (key looked up by id) payloads. Same `encodedKey` rules as `encryptString`. */
export function decryptString(payload: string, encodedKey?: string): string {
  const ring = ringFor(encodedKey);
  const parts = payload.split(".");
  let keyId: string;
  let segments: string[];
  if (parts[0] === V1 && parts.length === 4) {
    keyId = "k1";
    segments = parts.slice(1);
  } else if (parts[0] === V2 && parts.length === 5 && KEY_ID_PATTERN.test(parts[1] ?? "")) {
    keyId = parts[1] as string;
    segments = parts.slice(2);
  } else {
    throw new Error("Unknown ciphertext format");
  }
  const key = keyFor(ring, keyId);
  const iv = Buffer.from(segments[0] ?? "", "base64url");
  const tag = Buffer.from(segments[1] ?? "", "base64url");
  const ciphertext = Buffer.from(segments[2] ?? "", "base64url");
  if (tag.length !== 16) throw new Error("Invalid authentication tag length");
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** The key id a payload is under: `k1` for v1, the embedded id for v2. Throws on an unknown format. */
export function keyIdOf(payload: string): string {
  const parts = payload.split(".");
  if (parts[0] === V1 && parts.length === 4) return "k1";
  if (parts[0] === V2 && parts.length === 5 && KEY_ID_PATTERN.test(parts[1] ?? "")) return parts[1] as string;
  throw new Error("Unknown ciphertext format");
}

export {
  BACKUP_HEADER_BYTES,
  BACKUP_MAGIC,
  BACKUP_MIN_PASSPHRASE_LENGTH,
  BACKUP_TAG_BYTES,
  createBackupDecryptStream,
  createBackupEncryptStream,
} from "./backup";
