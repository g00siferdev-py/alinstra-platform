import { getEnv } from "@alinstra/config";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
};

/** Plain-text email sent to the admin when a provisioning run stops on a failed step. */
export function provisionFailedEmail(input: {
  clientName: string;
  stepLabel: string;
  error: string;
  clientUrl: string;
}): Pick<EmailMessage, "subject" | "text"> {
  return {
    subject: `Provisioning failed for ${input.clientName} at "${input.stepLabel}"`,
    text: [
      `Provisioning for ${input.clientName} stopped at the step "${input.stepLabel}".`,
      "",
      "Provider error:",
      input.error.trim() || "No error detail was recorded.",
      "",
      `Open the client to retry: ${input.clientUrl}`,
    ].join("\n"),
  };
}

/**
 * Plain-text email sent to a client owner after a sign-in from a network they have not used lately
 * (Phase S part 3). Shows only the time, a browser label, and a masked network prefix. No geo-IP.
 */
export function newSignInEmail(input: {
  whenText: string;
  browser: string;
  maskedNetwork: string;
  securityUrl: string;
}): Pick<EmailMessage, "subject" | "text"> {
  return {
    subject: "New sign-in to your Alinstra account",
    text: [
      "Your Alinstra account was just signed in to from a network we have not seen recently.",
      "",
      `When: ${input.whenText}`,
      `Browser: ${input.browser}`,
      `Network: ${input.maskedNetwork}`,
      "",
      "If this was you, there is nothing to do.",
      `If it was not, reset your password right away: ${input.securityUrl}`,
    ].join("\n"),
  };
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const env = getEnv();
  if (env.EMAIL_TRANSPORT === "console") {
    console.log(
      JSON.stringify({
        type: "email",
        to: message.to,
        subject: message.subject,
        text: message.text,
      }),
    );
    return;
  }

  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required when EMAIL_TRANSPORT=resend");
  }

  // Dynamic import so template-only consumers (and next build) do not pull Resend's optional peers.
  const { Resend } = await import("resend");
  const resend = new Resend(env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
  if (result.error) {
    throw new Error(`Resend rejected the message: ${result.error.name}`);
  }
}

export {
  billingPausedOwnerEmail,
  billingResumedOwnerEmail,
  paymentFailedOwnerEmail,
} from "./billing-emails";
export { monthlyReportOwnerEmail } from "./monthly-report-email";

