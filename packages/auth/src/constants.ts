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

export type RateLimitRule = { readonly limit: number; readonly windowSeconds: number };

/** Phase S part 5. Fixed windows, counted through `getCounter()`. */
export const RATE_LIMITS = {
  /** `/api/retell/*`, per client IP. */
  retellPerIp: { limit: 300, windowSeconds: 60 },
  /** Password reset requests, on top of `PASSWORD_RESET_LIMIT`. */
  passwordResetPerEmail: { limit: 5, windowSeconds: 60 * 60 },
  passwordResetPerIp: { limit: 20, windowSeconds: 60 * 60 },
  /** Invite send and resend, per client. */
  invitePerClient: { limit: 10, windowSeconds: 60 * 60 },
  /** Owner quick updates and change requests, per user. */
  ownerEditPerUser: { limit: 30, windowSeconds: 60 * 60 },
  /** Recording playback including Range requests, per user. */
  recordingPerUser: { limit: 120, windowSeconds: 10 * 60 },
  /** Knowledge document download, per user. */
  documentDownloadPerUser: { limit: 60, windowSeconds: 10 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 12;
