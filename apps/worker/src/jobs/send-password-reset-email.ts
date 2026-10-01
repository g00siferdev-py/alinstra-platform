import { sendEmail } from "@alinstra/email";

export async function sendPasswordReset(to: string, url: string): Promise<void> {
  await sendEmail({
    to,
    subject: "Reset your Alinstra password",
    text: `Set a new password: ${url}\nIf you did not ask for this, you can ignore the message.`,
  });
}
