import { POSTGRES_READY_PAGES, selectedBackend } from "@/lib/backend";
import { getT } from "@/lib/locale";

/** Prevent an unfinished PostgreSQL page from silently displaying legacy data. */
export async function postgresPageGate(page: string) {
  if (selectedBackend() !== "postgres" || POSTGRES_READY_PAGES.has(page)) return null;
  const t = await getT();
  return <section className="rounded-xl border border-line bg-surface p-6" role="status">
    <h2 className="text-lg font-semibold">{t("accounting.unavailable.title")}</h2>
    <p className="mt-2 text-sm text-ink-muted">{t("accounting.unavailable.body")}</p>
  </section>;
}
