import { SignedInSignupCard } from "@/components/signed-in-signup-card";
import { SignupForm } from "@/components/signup-form";
import { SignupPlanSummary } from "@/components/signup-plan-summary";
import { marketingMetadata } from "@/lib/marketing-seo";
import { getSession } from "@/lib/session";
import { publicPlans } from "@alinstra/db";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = marketingMetadata({
  title: "Sign up",
  description: "Create your Alinstra account and start checkout.",
  path: "/signup",
});

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const query = await searchParams;
  const raw = Array.isArray(query.plan) ? query.plan[0] : query.plan;
  const code = (raw ?? "").trim().toLowerCase();

  if (!code || code === "enterprise") {
    redirect(code === "enterprise" ? "/start?plan=enterprise" : "/start");
  }

  const plans = await publicPlans();
  const plan = plans.find((row) => row.code === code);
  if (!plan) {
    redirect("/start");
  }

  const session = await getSession();
  if (session) {
    return (
      <main className="mx-auto grid max-w-5xl gap-10 px-7 py-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)] lg:items-start">
        <div className="grid gap-6">
          <div className="grid gap-2">
            <h1 className="text-[40px] font-extrabold tracking-[-0.03em]">Create your account</h1>
            <p className="text-[var(--muted)]">You already have a session in this browser.</p>
          </div>
          <SignedInSignupCard email={session.user.email} role={session.user.role} planQuery={code} />
        </div>
        <SignupPlanSummary plan={plan} />
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-5xl gap-10 px-7 py-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(16rem,0.9fr)] lg:items-start">
      <div className="grid gap-6">
        <div className="grid gap-2">
          <h1 className="text-[40px] font-extrabold tracking-[-0.03em]">Create your account</h1>
          <p className="text-[var(--muted)]">
            Pay for {plan.name}, then set up your receptionist. You can finish checkout later if you need to.
          </p>
        </div>
        <SignupForm planId={plan.id} />
      </div>
      <SignupPlanSummary plan={plan} />
    </main>
  );
}
