import { SignOutControl } from "@/components/account-menu";
import { GuardedLink } from "@/components/guarded-link";
import { peekSession } from "@/lib/session";

export async function AppHeader() {
  const session = await peekSession();
  if (!session) return null;
  const role = session.user.role;
  const links =
    role === "admin"
      ? [
          ["/home", "Home"],
          ["/admin/clients", "Clients"],
          ["/admin/leads", "Leads"],
          ["/admin/plans", "Plans"],
          ["/admin/interview", "Interview"],
          ["/admin/services", "Services"],
        ]
      : role === "client_owner"
        ? [
            ["/home", "Home"],
            ["/home/business", "My Business"],
            ["/home/calls", "Calls"],
            ["/home/changes", "Change Requests"],
            ["/home/team", "Team"],
          ]
        : [
            ["/home", "Home"],
            ["/home/business", "My Business"],
            // Staff only see Calls once the owner grants call access.
            ...(session.user.canViewCalls === true ? [["/home/calls", "Calls"]] : []),
          ];

  return (
    <header className="border-b border-[var(--line)] bg-[var(--card)]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3">
        <GuardedLink className="text-base font-semibold text-[var(--ink)] no-underline" href="/home">
          Alinstra
        </GuardedLink>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          {links.map(([href, label]) => (
            <GuardedLink key={href} className="text-[var(--ink)] no-underline" href={href ?? "/home"}>
              {label}
            </GuardedLink>
          ))}
        </nav>
        <div className="ml-auto">
          <SignOutControl email={session.user.email} replaceAuthenticator={role === "admin" && session.user.twoFactorEnabled === true} />
        </div>
      </div>
    </header>
  );
}
