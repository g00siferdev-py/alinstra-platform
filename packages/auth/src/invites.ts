import { createHash, randomBytes } from "node:crypto";
import { getEnv } from "@alinstra/config";
import { encryptString } from "@alinstra/crypto";
import { prisma, type Role, type TenantContext } from "@alinstra/db";
import { enqueueSendInvite } from "@alinstra/queue";
import { INVITE_TTL_MS } from "./constants";
import { AuthError, createCredentialUser } from "./users";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvite(input: {
  actor: TenantContext & { id: string };
  email: string;
  role: "client_owner" | "client_staff";
  clientId: string;
}): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  if (input.actor.role === "admin") {
    if (input.role !== "client_owner") {
      throw new AuthError("Admin invites are for client owners.");
    }
  } else if (input.actor.role === "client_owner") {
    if (input.role !== "client_staff") {
      throw new AuthError("Owners can invite staff only.");
    }
    if (input.clientId !== input.actor.clientId) {
      throw new AuthError("Owners can invite staff only for their own client.");
    }
  } else {
    throw new AuthError("Staff cannot send invites.");
  }

  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true } });
  if (!client) throw new AuthError("Client not found.");

  const token = randomBytes(32).toString("base64url");
  const invite = await prisma.invite.create({
    data: {
      email,
      role: input.role,
      clientId: input.clientId,
      tokenHash: hashInviteToken(token),
      tokenCipher: encryptString(token, getEnv().ENCRYPTION_KEY),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      createdById: input.actor.id,
    },
  });

  await enqueueSendInvite({ inviteId: invite.id });
  return { id: invite.id };
}

/**
 * Accepts an invite. Role and clientId always come from the invite row.
 * There is no clientId parameter, so a caller cannot attach the new user to another client.
 */
export async function acceptInvite(input: {
  token: string;
  name: string;
  password: string;
}): Promise<{ id: string; email: string }> {
  const invite = await prisma.invite.findUnique({ where: { tokenHash: hashInviteToken(input.token) } });
  if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date()) {
    throw new AuthError("This invite is invalid or has expired.");
  }
  if (invite.role !== "client_owner" && invite.role !== "client_staff") {
    throw new AuthError("This invite is invalid or has expired.");
  }

  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existing) throw new AuthError("An account with this email already exists.");

  const claimed = await prisma.invite.updateMany({
    where: {
      id: invite.id,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { acceptedAt: new Date() },
  });
  if (claimed.count !== 1) throw new AuthError("This invite is invalid or has expired.");

  try {
    const user = await createCredentialUser({
      email: invite.email,
      name: input.name,
      password: input.password,
      role: invite.role as Role,
      clientId: invite.clientId,
    });
    return { id: user.id, email: invite.email };
  } catch (error) {
    await prisma.invite.update({ where: { id: invite.id }, data: { acceptedAt: null } });
    throw error;
  }
}
