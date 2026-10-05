import { AppHeader } from "@/components/app-header";

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      <div className="app-shell-main">{children}</div>
    </>
  );
}
