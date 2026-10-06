import { getEnv } from "@alinstra/config";
import { formatLocalTime } from "@alinstra/db";
import { newSignInEmail, sendEmail, type EmailMessage } from "@alinstra/email";
import type { SendSignInNotice } from "@alinstra/queue";

/** Owner "New sign-in to your Alinstra account" email (Phase S part 3). Time, browser label, masked network only. */
export async function sendSignInNotice(
  payload: SendSignInNotice,
  send: (message: EmailMessage) => Promise<void> = sendEmail,
): Promise<void> {
  const base = getEnv().APP_URL.replace(/\/$/, "");
  const whenText = formatLocalTime(payload.at, payload.timezone) || payload.at;
  const message = newSignInEmail({
    whenText,
    browser: payload.browser,
    maskedNetwork: payload.maskedNetwork,
    securityUrl: `${base}/forgot-password`,
  });
  await send({ to: payload.to, ...message });
}
