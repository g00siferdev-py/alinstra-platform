import { getEnv } from "@alinstra/config";
import { sendEmail } from "@alinstra/email";

export async function deliverAdminNotice(subject: string, text: string): Promise<void> {
  await sendEmail({
    to: getEnv().ADMIN_EMAIL,
    subject,
    text,
  });
}
