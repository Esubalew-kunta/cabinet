import type { Metadata } from "next";
import { Figtree, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { getLang } from "@/lib/i18n/server";
import { I18nProvider } from "@/components/i18n-provider";
import { ToastProvider } from "@/components/toast";

const body = Figtree({
  variable: "--font-body",
  subsets: ["latin"],
});

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cockpit Dr Amraoui",
  description: "Gestion du cabinet Cardio Check-Up",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = await getLang();
  return (
    <html lang={lang} className={`${body.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <I18nProvider lang={lang}>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
