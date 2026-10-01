import { randomBytes } from "node:crypto";
import { prisma, type Role } from "@alinstra/db";
import { auth } from "./auth";
import { MIN_PASSWORD_LENGTH } from "./constants";

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export async function createCredentialUser(input: {
  email: string;
  name: string;
  password: string;
  role: Role;
  clientId: string | null;
}): Promise<{ id: string }> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (input.role === "admin" && input.clientId !== null) {
    throw new AuthError("Admin users cannot belong to a client.");
  }
  if (input.role !== "admin" && !input.clientId) {
    throw new AuthError("Client users require a clientId.");
  }

  const ctx = await auth.$context;
  const password = await ctx.password.hash(input.password);
  const id = randomBytes(16).toString("hex");
  const created = await ctx.internalAdapter.createUser(
    {
      id,
      email: input.email.toLowerCase(),
      name: input.name,
      emailVerified: true,
      role: input.role,
      clientId: input.clientId,
    },
    { method: "email-password" },
  );
  if (!created) throw new AuthError("Could not create the user.");

  await ctx.internalAdapter.createAccount({
    id: randomBytes(16).toString("hex"),
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password,
  });

  await prisma.user.update({
    where: { id: created.id },
    data: { role: input.role, clientId: input.clientId, emailVerified: true },
  });

  return { id: created.id };
}
