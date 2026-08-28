import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { getLocale } from "@/lib/locale";
import { translate } from "@/lib/i18n";
import { I18nProvider } from "@/components/I18nProvider";
import { Nav } from "@/components/Nav";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  // The product name is a name, not copy — only the description is translated.
  return { title: "Tarjetas", description: translate(locale, "app.description") };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="mx-auto max-w-5xl bg-canvas px-4 text-ink antialiased">
        <I18nProvider locale={locale}>
          <Suspense><Nav /></Suspense>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
