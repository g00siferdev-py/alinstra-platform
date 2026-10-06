"use server";

import {
  AuthError,
  auth,
  clientIp,
  createCredentialUser,
  getCounter,
  MIN_PASSWORD_LENGTH,
} from "@alinstra/auth";
import { getEnv, log } from "@alinstra/config";
import {
  abandonSelfServeClient,
  attachSelfServeSignup,
  createSelfServeClient,
  ensureSelfServeCheckout,
  prisma,
  TERMS_VERSION,
} from "@alinstra/db";
import { platformsFor } from "@alinstra/providers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const SIGNUP_IP_LIMIT = 5;
const SIGNUP_IP_WINDOW = 60 * 60;
const SIGNUP_EMAIL_LIMIT = 3;
const SIGNUP_EMAIL_WINDOW = 24 * 60 * 60;

export type SignupFormState =
  | { ok: true; checkoutUrl: string }
  | { ok: false; error: string; existingAccount?: boolean }
  | null;

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function billingDeps() {
  const env = getEnv();
  return {
    billing: platformsFor(env).billing,
    appUrl: env.APP_URL,
  };
}

export async function signupAction(_prev: SignupFormState, formData: FormData): Promise<SignupFormState> {
  // Honeypot: bots fill hidden fields; pretend success so they leave.
  if (field(formData, "company_url").trim()) {
    return { ok: true, checkoutUrl: "/home" };
  }

  const businessName = field(formData, "businessName").trim();
  const ownerName = field(formData, "ownerName").trim();
  const email = field(formData, "email").trim().toLowerCase();
  const mobilePhone = field(formData, "mobilePhone").trim();
  const password = field(formData, "password");
  const planId = field(formData, "planId").trim();
  const terms = field(formData, "terms") === "on" || field(formData, "terms") === "true";

  if (!businessName || !ownerName || !email || !mobilePhone || !planId) {
    return { ok: false, error: "Fill in every required field." };
  }
  if (!terms) {
    return { ok: false, error: "Agree to the Terms of Service and Privacy Policy to continue." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  try {
    const headerList = await headers();
    const request = new Request("http://localhost/signup", { headers: headerList });
    const ip = clientIp(request);
    const counter = getCounter();
    const ipCount = await counter.increment(`signup:ip:${ip}`, SIGNUP_IP_WINDOW);
    if (ipCount > SIGNUP_IP_LIMIT) {
      return { ok: false, error: "Too many signups from this network. Try again in an hour." };
    }
    const emailCount = await counter.increment(`signup:email:${email}`, SIGNUP_EMAIL_WINDOW);
    if (emailCount > SIGNUP_EMAIL_LIMIT) {
      return { ok: false, error: "Too many signup attempts for this email. Try again tomorrow." };
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return { ok: false, error: "You already have an account. Sign in.", existingAccount: true };
    }

    const plan = await prisma.plan.findFirst({ where: { id: planId, active: true } });
    if (!plan) {
      return { ok: false, error: "That plan is not available." };
    }

    const { client } = await createSelfServeClient({
      businessName,
      ownerName,
      email,
      mobilePhone,
      planId: plan.id,
    });

    let userId: string;
    try {
      const user = await createCredentialUser({
        email,
        name: ownerName,
        password,
        role: "client_owner",
        clientId: client.id,
        emailVerified: false,
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
      });
      userId = user.id;
      await attachSelfServeSignup({
        clientId: client.id,
        ownerUserId: userId,
        businessName,
        ownerName,
        email,
        mobilePhone,
        planId: plan.id,
        planCode: plan.code,
      });
    } catch (error) {
      await abandonSelfServeClient(client.id).catch(() => undefined);
      if (error instanceof AuthError) {
        return { ok: false, error: error.message };
      }
      throw error;
    }

    await auth.api.signInEmail({
      body: { email, password },
      headers: headerList,
    });

    try {
      await auth.api.sendVerificationEmail({
        body: { email, callbackURL: "/home" },
        headers: headerList,
      });
    } catch (error) {
      log("warn", "signup.verification_email_failed", {
        userId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }

    const checkout = await ensureSelfServeCheckout(client.id, billingDeps());
    return { ok: true, checkoutUrl: checkout.url };
  } catch (error) {
    log("warn", "signup.failed", { error: error instanceof Error ? error.name : "unknown" });
    return { ok: false, error: error instanceof Error ? error.message : "Could not create your account. Try again." };
  }
}

export async function reopenCheckoutAction(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const headerList = await headers();
  const session = await auth.api.getSession({ headers: headerList });
  if (!session?.user || session.user.role !== "client_owner" || !session.user.clientId) {
    redirect("/login");
  }
  try {
    const checkout = await ensureSelfServeCheckout(session.user.clientId, billingDeps());
    return { ok: true, url: checkout.url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reopen checkout." };
  }
}

export async function resendVerificationAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const headerList = await headers();
  const session = await auth.api.getSession({ headers: headerList });
  if (!session?.user?.email) {
    return { ok: false, error: "Sign in to resend the confirmation email." };
  }
  if (session.user.emailVerified) {
    return { ok: true };
  }
  try {
    await auth.api.sendVerificationEmail({
      body: { email: session.user.email, callbackURL: "/home" },
      headers: headerList,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not resend the email." };
  }
}
