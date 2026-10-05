import { NavigationGuard } from "@/components/navigation-guard";
import { ToastProvider } from "@/components/toast";
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Alinstra",
  description: "Alinstra Technologies — practical AI for small businesses, starting with the phone.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plusJakarta.variable}>
      <body className={plusJakarta.className}>
        <ToastProvider>
          <NavigationGuard>{children}</NavigationGuard>
        </ToastProvider>
      </body>
    </html>
  );
}
