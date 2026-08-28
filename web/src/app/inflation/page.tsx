import { getDb } from "@/lib/db";
import { loadCpi } from "@/lib/cpi";
import { personalInflation } from "@/lib/queries";
import { InflationLines } from "@/components/InflationLines";

export const dynamic = "force-dynamic";

export default async function Inflation() {
  const { points, basket } = personalInflation(getDb(), loadCpi());
  const last = points.at(-1);
  const gap = last ? last.personal - last.official : 0;
  return (
    <main>
      <h1 className="text-xl font-semibold mb-2">Your inflation vs INDEC</h1>
      {last && (
        <p className="text-sm mb-4">
          Since {points[0].month}, your recurring basket is up{" "}
          <strong>{(last.personal - 100).toFixed(1)}%</strong> while official IPC is up{" "}
          <strong>{(last.official - 100).toFixed(1)}%</strong> —{" "}
          <span className={gap > 0 ? "text-negative font-medium" : "text-positive font-medium"}>
            {gap > 0 ? "you are paying more than average" : "you are beating average inflation"}
          </span>.
        </p>
      )}
      <InflationLines data={points} />
      <p className="text-xs text-ink-muted mt-3">
        Both indices are based at 100 in {points[0]?.month ?? "the first month"}. Your line reprices
        the {basket.length} merchants you actually pay every month, chained month to month using only
        merchants charged in both — so a merchant joining or leaving never moves the index by itself,
        and only once-a-month charges count, so buying more does not read as paying more.
        Basket: {basket.join(", ")}.
      </p>
    </main>
  );
}
