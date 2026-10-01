import { scrubSentryEvent, type SentryLikeEvent } from "@alinstra/config/scrub";
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubSentryEvent(event as SentryLikeEvent) as typeof event;
  },
});
