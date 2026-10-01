import { getEnv, log } from "@alinstra/config";
import { prisma } from "@alinstra/db";
import { enqueueSendPasswordReset, getRedis } from "@alinstra/queue";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { ADMIN_SESSION_MS, CLIENT_SESSION_SECONDS, CLIENT_SESSION_UPDATE_AGE_SECONDS, MIN_PASSWORD_LENGTH } from "./constants";
import { redisSecondaryStorage } from "./redis-storage";

function useMemoryLimits(): boolean {
  const env = getEnv();
  return env.NODE_ENV === "test" || env.LOCKOUT_STORE === "memory";
}

type SessionWrite = {
  userId?: string;
  expiresAt?: Date | string;
};

function adminCapFromContext(context: unknown): Date | null {
  if (!context || typeof context !== "object") return null;
  const session = (context as { context?: { session?: { user?: { role?: string }; session?: { createdAt?: Date | string } } } })
    .context?.session;
  if (session?.user?.role !== "admin" || !session.session?.createdAt) return null;
  return new Date(new Date(session.session.createdAt).getTime() + ADMIN_SESSION_MS);
}

const env = getEnv();

export const auth = betterAuth({
  appName: "Alinstra",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      const url = `${getEnv().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await enqueueSendPasswordReset({ to: user.email, url });
      log("info", "password reset email queued");
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "client_staff",
        input: false,
      },
      clientId: {
        type: "string",
        required: false,
        input: false,
      },
    },
  },
  session: {
    expiresIn: CLIENT_SESSION_SECONDS,
    updateAge: CLIENT_SESSION_UPDATE_AGE_SECONDS,
  },
  rateLimit: {
    enabled: env.NODE_ENV !== "test",
    window: 60,
    max: 100,
    storage: useMemoryLimits() ? "memory" : "secondary-storage",
  },
  secondaryStorage: useMemoryLimits() ? undefined : redisSecondaryStorage(getRedis()),
  plugins: [
    twoFactor({
      issuer: "Alinstra",
      backupCodeOptions: {
        storeBackupCodes: "encrypted",
      },
    }),
  ],
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const userId = (session as SessionWrite).userId;
          if (!userId) return { data: session };
          const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
          if (user?.role !== "admin") return { data: session };
          return {
            data: {
              ...session,
              expiresAt: new Date(Date.now() + ADMIN_SESSION_MS),
            },
          };
        },
      },
      update: {
        before: async (data, context) => {
          const cap = adminCapFromContext(context);
          const expiresAt = (data as SessionWrite).expiresAt;
          if (!cap || !expiresAt) return { data };
          const requested = new Date(expiresAt);
          if (requested <= cap) return { data };
          return { data: { ...data, expiresAt: cap } };
        },
      },
    },
  },
});

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
