import { getEnv, log } from "@alinstra/config";
import { prisma, recordEmailChange } from "@alinstra/db";
import { enqueueAccountEmail, enqueueSendPasswordReset, getRedis } from "@alinstra/queue";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins";
import { ADMIN_SESSION_MS, CLIENT_SESSION_SECONDS, CLIENT_SESSION_UPDATE_AGE_SECONDS, MIN_PASSWORD_LENGTH } from "./constants";
import { redisSecondaryStorage } from "./redis-storage";
import { sessionBlockedForUser } from "./client-access";

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

const pendingEmailChange = new Map<string, string>();

const env = getEnv();

export const auth = betterAuth({
  appName: "Alinstra",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await enqueueAccountEmail({
        to: user.email,
        subject: "Confirm your Alinstra email",
        text: `Confirm this email address for Alinstra:\n\n${url}\n\nIf you did not ask for this, you can ignore the message.`,
      });
    },
  },
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
    changeEmail: {
      enabled: true,
    },
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
  advanced: {
    ipAddress: {
      // Railway sets and overwrites X-Real-IP. handleAuthRequest copies our
      // resolved client IP into this header and drops X-Forwarded-For first.
      ipAddressHeaders: ["x-real-ip"],
    },
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
    user: {
      update: {
        before: async (data, context) => {
          const nextEmail = typeof (data as { email?: unknown }).email === "string" ? (data as { email: string }).email : "";
          const current = (context as { context?: { session?: { user?: { id?: string; email?: string } } } } | null)?.context?.session?.user;
          if (nextEmail && current?.id && current.email && nextEmail.toLowerCase() !== current.email.toLowerCase()) {
            pendingEmailChange.set(current.id, current.email);
          }
          return { data };
        },
        after: async (user) => {
          const row = user as { id?: string; email?: string; role?: string; clientId?: string | null };
          if (!row.id || !row.email) return;
          const previous = pendingEmailChange.get(row.id);
          if (!previous) return;
          pendingEmailChange.delete(row.id);
          const role = row.role === "admin" || row.role === "client_owner" || row.role === "client_staff" ? row.role : "client_staff";
          await recordEmailChange({
            userId: row.id,
            role,
            clientId: row.clientId ?? null,
            previousEmail: previous,
            nextEmail: row.email,
          });
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const userId = (session as SessionWrite).userId;
          if (!userId) return { data: session };
          if (await sessionBlockedForUser(userId)) return false;
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
