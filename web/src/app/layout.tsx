import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { getLocale } from "@/lib/locale";
import { translate } from "@/lib/i18n";
import { getDb } from "@/lib/db";
import { loadCpi, latestMonth } from "@/lib/cpi";
import { chromeData } from "@/lib/queries";
import { I18nProvider } from "@/components/I18nProvider";
import { Nav } from "@/components/Nav";
import { PageChrome, PageChromeFallback } from "@/components/PageChrome";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  // The product name is a name, not copy — only the description is translated.
  return { title: "Tarjetas", description: translate(locale, "app.description") };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // The three facts the header needs before it knows which page it is. Cheap, and the same for
  // every route — which is the reason the header can live up here at all. `cookies()` in
  // getLocale already makes this layout dynamic, so these are read per request.
  const { months, latestClosing } = chromeData(getDb());
  const baseMonth = latestMonth(loadCpi());
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
              <div className="mx-auto w-full max-w-[150rem]">
                {/* The chrome reads the URL, so it is a client component and Next puts it
                    behind a boundary. The fallback is its own empty frame: on the routes where
                    that boundary streams, the page must not start 104px high and then drop. */}
                <Suspense fallback={<PageChromeFallback />}>
                  <PageChrome months={months} latestClosing={latestClosing} baseMonth={baseMonth} />
                </Suspense>
                {children}
              </div>
            </div>
          </div>
        </I18nProvider>
      </body>
    </html>
  );
}
