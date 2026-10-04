import { getEnv } from "@alinstra/config";
import { Resend } from "resend";

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
