import { createHmac, timingSafeEqual } from "node:crypto";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

function sameHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function signRetell(rawBody: string, timestampMs: number, apiKey: string): string {
  const digest = createHmac("sha256", apiKey).update(`${rawBody}${timestampMs}`).digest("hex");
  return `v=${timestampMs},d=${digest}`;
}

export function verifyRetell(rawBody: string, header: string | null, apiKey: string, now = Date.now()): boolean {
  if (!header || !apiKey) return false;
  const match = /^v=(\d+),d=([0-9a-f]+)$/i.exec(header.trim());
  if (!match?.[1] || !match[2]) return false;
  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > FIVE_MINUTES_MS) return false;
  const expected = createHmac("sha256", apiKey).update(`${rawBody}${timestamp}`).digest("hex");
  return sameHex(expected, match[2]);
}

export function signStripe(rawBody: string, timestampSec: number, secret: string): string {
  const digest = createHmac("sha256", secret).update(`${timestampSec}.${rawBody}`).digest("hex");
  return `t=${timestampSec},v1=${digest}`;
}

export function verifyStripe(rawBody: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const signatures: string[] = [];
  let timestamp = Number.NaN;
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(now - timestamp * 1000) > FIVE_MINUTES_MS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  let matched = false;
  for (const digest of signatures) matched = sameHex(expected, digest) || matched;
  return matched;
}
