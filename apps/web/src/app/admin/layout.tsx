import { AppHeader } from "@/components/app-header";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}
