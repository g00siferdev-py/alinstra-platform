/**
 * Client-safe copies of the call retention limits (`complianceSchema.callRetentionDays` in @alinstra/db
 * is the source of truth; that package cannot be imported from client components).
 */
export const CALL_RETENTION_MIN_DAYS = 7;
export const CALL_RETENTION_MAX_DAYS = 365;
export const CALL_RETENTION_DEFAULT_DAYS = 90;
export const CALL_RETENTION_HINT = "How long transcripts, recordings, and caller numbers are kept before they are purged. Duration, outcome, and cost stay.";
export const CALL_RETENTION_HEALTHCARE_HINT = "Healthcare-sensitive client: shorter is better. 30 days or less is a reasonable default.";
