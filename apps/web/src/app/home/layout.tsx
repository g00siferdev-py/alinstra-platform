import { AppHeader } from "@/components/app-header";

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}
