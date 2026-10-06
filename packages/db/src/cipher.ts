import { decryptString, encryptString } from "@alinstra/crypto";

/**
 * Column-level encryption helpers (AES-256-GCM via @alinstra/crypto, keyring from env).
 * Never log what goes in or comes out of these. Log ids and counts only.
 */

/** Encrypts with the active key; always writes the v2 format. Null and empty stay null. */
export function seal(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return encryptString(value);
}

/** Decrypts a cipher column. Null in, null out. An unreadable payload also yields null (never throws, never leaks). */
export function open(cipher: string | null | undefined): string | null {
  if (!cipher) return null;
  try {
    return decryptString(cipher);
  } catch {
    return null;
  }
}

export function sealJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return encryptString(JSON.stringify(value));
}

export function openJson<T = unknown>(cipher: string | null | undefined): T | null {
  const text = open(cipher);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Reads a field that may be encrypted: the cipher wins, plaintext is the fallback for rows not yet backfilled. */
export function readField(cipher: string | null | undefined, plain: string | null | undefined): string {
  return open(cipher) ?? plain ?? "";
}

// ---------------------------------------------------------------------------
// Phone masking
// ---------------------------------------------------------------------------

/**
 * Display mask for a phone number. NANP numbers become `(423) ***-0198`; anything else keeps only the last
 * four digits (`***-0198`). Fewer than four digits give `***`.
 */
export function maskPhoneDisplay(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  const last4 = digits.slice(-4);
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10) return `(${national.slice(0, 3)}) ***-${last4}`;
  return `***-${last4}`;
}

/** Candidate phone-like runs: optional +, digits, and common separators. Filtered by digit count below. */
const PHONE_CANDIDATE = /(?<![\w])\+?\d[\d\s().-]{8,}\d(?!\w)/g;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/;

/** Replaces every 10+ digit phone number in a string with its masked form. */
export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_CANDIDATE, (match) => {
    const count = match.replace(/\D/g, "").length;
    // Several numbers on consecutive lines run together in one candidate: mask line by line.
    if (/\n/.test(match)) return match.split(/(\r?\n)/).map((part) => (/\n/.test(part) ? part : maskPhonesInText(part))).join("");
    if (count < 10 || count > 15 || DATE_LIKE.test(match)) return match;
    return maskPhoneDisplay(match);
  });
}

/** Deep copy of a JSON value with every phone number in every string masked. Keys are left alone. */
export function maskPhonesIn<T>(value: T): T {
  if (typeof value === "string") return maskPhonesInText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((item) => maskPhonesIn(item)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = key === SEALED_KEY ? item : maskPhonesIn(item);
    return out as T;
  }
  return value;
}

export function containsPhone(value: unknown): boolean {
  return JSON.stringify(value ?? null) !== JSON.stringify(maskPhonesIn(value ?? null));
}

// ---------------------------------------------------------------------------
// Column shapes
// ---------------------------------------------------------------------------

/** Create/update data for a TransferTarget: ciphertext and mask only, legacy plaintext column null. */
export function transferTargetData(row: { label: string; e164: string }): { label: string; e164: null; e164Cipher: string | null; e164Masked: string } {
  return { label: row.label, e164: null, e164Cipher: seal(row.e164), e164Masked: maskPhoneDisplay(row.e164) };
}

/** The number for a transfer target: ciphertext first, legacy plaintext as the fallback. Empty string if unreadable. */
export function transferNumberOf(row: { e164?: string | null; e164Cipher?: string | null }): string {
  return readField(row.e164Cipher, row.e164);
}

/** Row with `e164` filled in for display and publishing. Decrypt only where the number is actually needed. */
export function withTransferNumber<T extends { e164: string | null; e164Cipher: string | null }>(row: T): Omit<T, "e164"> & { e164: string } {
  return { ...row, e164: transferNumberOf(row) };
}

/** Create data for a ClientMessage: ciphertext and mask only, legacy plaintext columns null. */
export function messageData(input: { callerName: string; callbackNumber: string; body: string }): {
  callerName: null;
  callbackNumber: null;
  body: null;
  callerNameCipher: string | null;
  callbackNumberCipher: string | null;
  bodyCipher: string | null;
  callbackMasked: string | null;
} {
  return {
    callerName: null,
    callbackNumber: null,
    body: null,
    callerNameCipher: seal(input.callerName),
    callbackNumberCipher: seal(input.callbackNumber),
    bodyCipher: seal(input.body),
    callbackMasked: input.callbackNumber ? maskPhoneDisplay(input.callbackNumber) : null,
  };
}

type MessageColumns = {
  callerName: string | null;
  callbackNumber: string | null;
  body: string | null;
  callerNameCipher: string | null;
  callbackNumberCipher: string | null;
  bodyCipher: string | null;
  callbackMasked: string | null;
};

/** A message row with the readable fields filled in (cipher first, plaintext fallback). */
export function withMessageText<T extends MessageColumns>(row: T): Omit<T, "callerName" | "callbackNumber" | "body"> & { callerName: string; callbackNumber: string; body: string } {
  return {
    ...row,
    callerName: readField(row.callerNameCipher, row.callerName),
    callbackNumber: readField(row.callbackNumberCipher, row.callbackNumber),
    body: readField(row.bodyCipher, row.body),
  };
}

/** KnowledgeBase.staff: ciphertext first (JSON), legacy plaintext Json as the fallback. */
export function staffOf(row: { staff: unknown; staffCipher?: string | null }): unknown {
  const sealed = openJson(row.staffCipher);
  return sealed ?? row.staff ?? null;
}

/** KnowledgeDocument.extractedText: ciphertext first, legacy plaintext fallback. Null if neither. */
export function extractedTextOf(row: { extractedText?: string | null; extractedTextCipher?: string | null }): string | null {
  return open(row.extractedTextCipher) ?? row.extractedText ?? null;
}

// ---------------------------------------------------------------------------
// Sealed JSON payloads (QuickUpdate.payload)
// ---------------------------------------------------------------------------

/** Key in a stored payload holding the encrypted original, when the visible copy had numbers masked. */
export const SEALED_KEY = "__sealed";

/**
 * Prepares a payload for a JSON log column. Numbers are masked in the stored copy. When masking changed
 * something and the payload must still be applied later (held updates), the original rides along encrypted
 * under `__sealed`. Payloads without phone numbers are stored untouched.
 */
export function protectPayload<T>(payload: T): T {
  if (!containsPhone(payload)) return payload;
  const masked = maskPhonesIn(payload);
  if (!masked || typeof masked !== "object" || Array.isArray(masked)) return masked;
  return { ...(masked as Record<string, unknown>), [SEALED_KEY]: sealJson(payload) } as T;
}

/** Inverse of `protectPayload`. Rows without `__sealed` (older rows, payloads with no numbers) pass through. */
export function openPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const sealed = (payload as Record<string, unknown>)[SEALED_KEY];
  if (typeof sealed !== "string") return payload;
  return openJson(sealed) ?? stripSealed(payload as Record<string, unknown>);
}

function stripSealed(payload: Record<string, unknown>): Record<string, unknown> {
  const { [SEALED_KEY]: _sealed, ...rest } = payload;
  void _sealed;
  return rest;
}
