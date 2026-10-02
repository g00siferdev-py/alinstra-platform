const DIGITS = 6;
const PERIOD_MS = 30_000;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

async function hotp(secret: string, counter: number): Promise<string> {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, BigInt(counter), false);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, buffer));
  const offset = (signature[signature.length - 1] ?? 0) & 15;
  const truncated =
    ((signature[offset] ?? 0) & 127) << 24 |
    ((signature[offset + 1] ?? 0) & 255) << 16 |
    ((signature[offset + 2] ?? 0) & 255) << 8 |
    ((signature[offset + 3] ?? 0) & 255);
  return String(truncated % 10 ** DIGITS).padStart(DIGITS, "0");
}

export async function verifyTotp(secret: string, code: string): Promise<boolean> {
  const counter = Math.floor(Date.now() / PERIOD_MS);
  for (let offset = -1; offset <= 1; offset += 1) {
    if ((await hotp(secret, counter + offset)) === code) return true;
  }
  return false;
}

function base32(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let result = "";
  let buffer = 0;
  let shift = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    shift += 8;
    while (shift >= 5) {
      shift -= 5;
      result += ALPHABET[(buffer >> shift) & 31];
    }
  }
  if (shift > 0) result += ALPHABET[(buffer << (5 - shift)) & 31];
  return result;
}

export function totpUri(secret: string, issuer: string, account: string): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(account);
  const params = new URLSearchParams({
    secret: base32(secret),
    issuer,
    digits: String(DIGITS),
    period: "30",
  });
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?${params.toString()}`;
}
