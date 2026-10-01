import { getEnv, scrubSentryEvent, type SentryLikeEvent } from "@alinstra/config";
import * as Sentry from "@sentry/nextjs";

const env = getEnv();

Sentry.init({
  dsn: env.SENTRY_DSN || undefined,
  environment: env.SENTRY_ENVIRONMENT,
  sendDefaultPii: false,
  beforeSend(event) {
    return scrubSentryEvent(event as SentryLikeEvent) as typeof event;
  },
});
