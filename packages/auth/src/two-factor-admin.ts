import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { prisma } from "@alinstra/db";
import { auth } from "./auth";
import { totpUri, verifyTotp } from "./totp";

type SecretKey = Parameters<typeof symmetricDecrypt>[0]["key"];

function backupCodeList(): string[] {
  return Array.from({ length: 10 }, () => {
    const raw = generateRandomString(10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

async function secretKey(): Promise<SecretKey> {
  const context = await auth.$context;
  return (context as { secretConfig: SecretKey }).secretConfig;
}

export async function sessionRole(request: Request): Promise<"admin" | "client" | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (!user) return null;
  return user.role === "admin" ? "admin" : "client";
}

export async function reenrollAdminTwoFactor(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ message: "Sign in first." }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, role: true, twoFactorEnabled: true },
  });
  if (!user || user.role !== "admin") {
    return Response.json({ message: "Only an admin can replace an authenticator this way." }, { status: 403 });
  }
  if (!user.twoFactorEnabled) {
    return Response.json({ message: "Set up two-factor authentication first." }, { status: 400 });
  }

  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code.trim() : "";
  } catch {
    code = "";
  }
  if (!code) return Response.json({ message: "Enter a current authenticator or backup code." }, { status: 400 });

  const row = await prisma.twoFactor.findUnique({ where: { userId: user.id } });
  if (!row?.secret) return Response.json({ message: "Two-factor authentication is not enrolled." }, { status: 400 });

  const key = await secretKey();
  const currentSecret = await symmetricDecrypt({ key, data: row.secret });
  const totpOk = await verifyTotp(currentSecret, code);
  let backupOk = false;
  if (!totpOk && row.backupCodes) {
    try {
      const raw = await symmetricDecrypt({ key, data: row.backupCodes });
      const codes = JSON.parse(raw) as unknown;
      backupOk = Array.isArray(codes) && codes.some((item) => item === code);
    } catch {
      backupOk = false;
    }
  }
  if (!totpOk && !backupOk) {
    return Response.json({ message: "That code was not accepted." }, { status: 401 });
  }

  const nextSecret = generateRandomString(32);
  const backupCodes = backupCodeList();
  await prisma.twoFactor.update({
    where: { id: row.id },
    data: {
      secret: await symmetricEncrypt({ key, data: nextSecret }),
      backupCodes: await symmetricEncrypt({ key, data: JSON.stringify(backupCodes) }),
      verified: true,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });

  return Response.json({
    totpURI: totpUri(nextSecret, "Alinstra", user.email),
    backupCodes,
  });
}
