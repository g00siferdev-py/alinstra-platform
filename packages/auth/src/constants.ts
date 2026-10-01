export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000;
export const CLIENT_SESSION_SECONDS = 7 * 24 * 60 * 60;
export const CLIENT_SESSION_UPDATE_AGE_SECONDS = 60 * 60;

export const LOGIN_LOCKOUT = {
  maxFailures: 5,
  windowSeconds: 15 * 60,
} as const;

/** Failures for one account, ignoring IP, so rotating spoofed addresses cannot skip the lockout. */
export const ACCOUNT_LOGIN_LOCKOUT = {
  maxFailures: 20,
  windowSeconds: 60 * 60,
} as const;

export const PASSWORD_RESET_LIMIT = {
  maxRequests: 3,
  windowSeconds: 15 * 60,
} as const;

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 12;
