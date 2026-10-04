import { NavigationGuard } from "@/components/navigation-guard";
import { ToastProvider } from "@/components/toast";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alinstra",
  description: "Alinstra Technologies — practical AI for small businesses, starting with the phone.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <NavigationGuard>{children}</NavigationGuard>
        </ToastProvider>
      </body>
    </html>
  );
}
