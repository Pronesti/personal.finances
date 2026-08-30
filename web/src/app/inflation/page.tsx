import { getDb } from "@/lib/db";
import { loadCpi } from "@/lib/cpi";
import { personalInflation } from "@/lib/queries";
import { InflationLines } from "@/components/InflationLines";
import { getT } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function Inflation() {
  const { points, basket } = personalInflation(getDb(), loadCpi());
  const last = points.at(-1);
  const gap = last ? last.personal - last.official : 0;
  const tr = await getT();
  return (
    <main>
      {last && (
        <p className="text-sm mb-4">
          {tr("inflation.lead.since", { month: points[0].month })}{" "}
          <strong>{(last.personal - 100).toFixed(1)}%</strong> {tr("inflation.lead.while")}{" "}
          <strong>{(last.official - 100).toFixed(1)}%</strong> —{" "}
          <span className={gap > 0 ? "text-negative font-medium" : "text-positive font-medium"}>
            {tr(gap > 0 ? "inflation.verdict.worse" : "inflation.verdict.better")}
          </span>.
        </p>
      )}
      <InflationLines data={points} />
      <p className="mt-3 max-w-[80ch] text-xs text-ink-muted">
        {tr("inflation.note", {
          month: points[0]?.month ?? tr("inflation.firstMonth"),
          count: basket.length,
        })}{" "}
        {tr("inflation.basket", { basket: basket.join(", ") })}
      </p>

      <p className="mt-8 max-w-[80ch] border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">{tr("inflation.footer")}</p>
    </main>
  );
}
