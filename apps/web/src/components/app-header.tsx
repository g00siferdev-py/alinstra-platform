import { SignOutControl } from "@/components/account-menu";
import { AppNav, type AppNavLink } from "@/components/app-nav";
import { GuardedLink } from "@/components/guarded-link";
import { WaveformMark } from "@/components/ui";
import { peekSession } from "@/lib/session";

export async function AppHeader({ liveCallCount = 0 }: { liveCallCount?: number }) {
  const session = await peekSession();
  if (!session) return null;
  const role = session.user.role;
  const liveBadge = liveCallCount > 0 ? `${liveCallCount} live` : null;

  const links: AppNavLink[] =
    role === "admin"
      ? [
          { href: "/home", label: "Home" },
          { href: "/admin/clients", label: "Clients" },
          { href: "/admin/calls", label: "Calls", badge: liveBadge },
          { href: "/admin/leads", label: "Leads" },
          { href: "/admin/plans", label: "Plans" },
          { href: "/admin/interview", label: "Interview" },
          { href: "/admin/access", label: "Access" },
          { href: "/admin/reports", label: "Reports" },
          { href: "/admin/services", label: "Services" },
        ]
      : role === "client_owner"
        ? [
            { href: "/home", label: "Home" },
            { href: "/home/business", label: "My Business" },
            { href: "/home/billing", label: "Billing" },
            { href: "/home/reports", label: "Reports" },
            { href: "/home/calls", label: "Calls" },
            { href: "/home/changes", label: "Change Requests" },
            { href: "/home/team", label: "Team" },
            { href: "/home/access", label: "Who viewed" },
          ]
        : [
            { href: "/home", label: "Home" },
            { href: "/home/business", label: "My Business" },
            ...(session.user.canViewCalls === true ? [{ href: "/home/calls", label: "Calls" }] : []),
          ];

  return (
    <header className="border-b border-[var(--line)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-x-5 gap-y-3 px-7 py-3">
        <GuardedLink className="inline-flex items-center gap-2.5 no-underline" href="/home">
          <span className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[var(--primary)]">
            <WaveformMark />
          </span>
          <span className="text-lg font-extrabold tracking-[-0.02em] text-[var(--ink)]">Alinstra</span>
        </GuardedLink>
        <AppNav links={links} />
        <div className="ml-auto">
          <SignOutControl
            email={session.user.email}
            replaceAuthenticator={role === "admin" && session.user.twoFactorEnabled === true}
          />
        </div>
      </div>
    </header>
  );
}
