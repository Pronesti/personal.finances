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
      <body className="bg-canvas text-ink antialiased">
        <I18nProvider locale={locale}>
          {/* Sidebar beside the content, not above it: on a wide screen the width a top nav bar
              would waste on empty tab row goes to the charts instead. */}
          <div className="lg:flex lg:items-start">
            <Suspense><Nav /></Suspense>
            <div className="min-w-0 flex-1 px-4 py-6 lg:px-8">
              {/* Capped so the reading column stays sane on an ultrawide monitor, but far wider
                  than a page of prose — charts and tables are what fills it. */}
              <div className="mx-auto w-full max-w-[150rem]">{children}</div>
            </div>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
