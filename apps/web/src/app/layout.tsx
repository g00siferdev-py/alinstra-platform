import { AppHeader } from "@/components/app-header";
import { NavigationGuard } from "@/components/navigation-guard";
import { ToastProvider } from "@/components/toast";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alinstra",
  description: "Alinstra Technologies operations platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <NavigationGuard>
            <AppHeader />
            {children}
          </NavigationGuard>
        </ToastProvider>
      </body>
    </html>
  );
}
