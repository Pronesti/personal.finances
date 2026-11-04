import Link from "next/link";
import { notFound } from "next/navigation";
import { selectedBackend, withAccounting } from "@/lib/backend";
import { getT } from "@/lib/locale";
import { evidenceRouteId, evidenceView } from "@/lib/accounting/evidence-view";

export default async function AccountingEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  if (selectedBackend() !== "postgres") notFound();
  const id = evidenceRouteId((await params).id);
  if (!id) notFound();
  const source = await withAccounting(({ ledger }) => ledger.transaction(tx => evidenceView(tx, id)));
  if (!source) notFound();
  const status = source.revision.admission;
  const description = source.line?.payload.description ?? source.line?.payload.raw_line;
  return <div className="space-y-5">
    <Link href="/accounting" className="text-sm underline underline-offset-4">{t("accounting.source.back")}</Link>
    
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <div><dt className="text-ink-muted">{t("accounting.source.status")}</dt><dd>{t(`accounting.source.${status}`)}</dd></div>
      <div><dt className="text-ink-muted">{t("accounting.source.recorded")}</dt><dd>{source.revision.recordedAt}</dd></div>
    </dl>
    <a href={`/api/accounting/documents/${source.revision.documentHash}`} target="_blank" rel="noreferrer" className="inline-block rounded-lg border border-line px-4 py-3 text-sm font-semibold">
      {t("accounting.source.original")}
    </a>
    {typeof description === "string" && <section className="rounded-xl border border-line p-4">
      <h2 className="font-semibold">{t("accounting.source.line")}</h2>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm">{description}</p>
    </section>}
    <details className="rounded-xl border border-line p-4">
      <summary className="cursor-pointer font-semibold">{t("accounting.source.extracted")}</summary>
      <pre className="mt-4 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(source.line?.payload ?? source.revision.rawPayload, null, 2)}</pre>
    </details>
  </div>;
}
