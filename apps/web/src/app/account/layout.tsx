import { AppHeader } from "@/components/app-header";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}