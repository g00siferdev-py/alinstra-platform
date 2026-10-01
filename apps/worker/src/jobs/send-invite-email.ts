import { prisma } from "@alinstra/db";
import { decryptString } from "@alinstra/crypto";
import { getEnv } from "@alinstra/config";
import { sendEmail } from "@alinstra/email";

// Exception: invite rows are not a tenant read. See docs/DECISIONS.md.
export async function sendInvite(inviteId: string): Promise<void> {
  const env = getEnv();
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.acceptedAt || invite.revokedAt || !invite.tokenCipher) return;
  const token = decryptString(invite.tokenCipher, env.ENCRYPTION_KEY);
  const url = `${env.APP_URL}/invite/${token}`;
  await sendEmail({
    to: invite.email,
    subject: "You're invited to Alinstra",
    text: `Accept your invite: ${url}\nThis link expires and can be used once.`,
  });
  await prisma.invite.update({
    where: { id: invite.id },
    data: { emailSentAt: new Date(), tokenCipher: null },
  });
}
