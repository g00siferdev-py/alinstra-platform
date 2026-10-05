import { listLiveCalls, type Actor } from "@alinstra/db";
import { AppHeader } from "@/components/app-header";
import { peekSession } from "@/lib/session";

export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const session = await peekSession();
  let liveCallCount = 0;
  if (session?.user.role === "admin" && session.user.twoFactorEnabled) {
    try {
      const actor: Actor = { id: session.user.id, role: "admin" };
      liveCallCount = (await listLiveCalls(actor)).length;
    } catch {
      liveCallCount = 0;
    }
  }

  return (
    <>
      <AppHeader liveCallCount={liveCallCount} />
      <div className="app-shell-main">{children}</div>
    </>
  );
}
