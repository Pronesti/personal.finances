import { getT } from "@/lib/locale";

/** Purpose first, detailed reading instructions available before the results. */
export async function PageGuide({ summary, detail }: { summary: string; detail: string }) {
  const tr = await getT();
  return (
    <div className="page-guide w-full text-sm leading-relaxed text-ink-muted">
      <p className="max-w-[85ch]">{summary}</p>
      <details className="mt-2 max-w-[85ch]">
        <summary className="inline-block cursor-pointer rounded-md py-2 font-medium text-accent hover:underline">
          {tr("guide.label")} <span className="guide-chevron inline-block transition-transform" aria-hidden="true">⌄</span>
        </summary>
        <p className="mt-2 rounded-lg border border-line bg-surface p-4">{detail}</p>
      </details>
    </div>
  );
}
