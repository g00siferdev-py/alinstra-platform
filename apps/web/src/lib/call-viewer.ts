import type { CallViewer } from "@alinstra/db";

type SessionUser = { id: string; role: string; clientId?: string | null; canViewCalls?: boolean | null; twoFactorEnabled?: boolean | null };

/**
 * Turns a session user into the viewer the calls module checks. Null when the user cannot act at all
 * (admin without 2FA, portal user without a client). Staff get `canViewCalls` from the user row.
 */
export function callViewerFor(user: SessionUser): CallViewer | null {
  if (user.role === "admin") return user.twoFactorEnabled ? { id: user.id, role: "admin" } : null;
  if (!user.clientId) return null;
  if (user.role === "client_owner") return { id: user.id, role: "client_owner", clientId: user.clientId };
  return { id: user.id, role: "client_staff", clientId: user.clientId, canViewCalls: user.canViewCalls === true };
}

/** Parses an HTTP `Range: bytes=a-b` header against a known size. Null when absent or unsatisfiable. */
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (!startText && !endText) return null;
  if (!startText) {
    const suffix = Number(endText);
    if (suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startText);
  const end = endText ? Math.min(Number(endText), size - 1) : size - 1;
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}
