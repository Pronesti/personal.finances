/**
 * One headline number with its label and a line of context — the tile every analysis page opens
 * with, written once instead of thirty times.
 */
export function Stat({ label, value, detail, tone }: {
  label: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  /** Text colour class for the number, when its sign carries meaning. */
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className={`text-2xl font-bold${tone ? ` ${tone}` : ""}`}>{value}</div>
      {detail != null && <div className="text-sm text-ink-muted">{detail}</div>}
    </div>
  );
}

/**
 * A page's stats and its charts, laid out by how much room there is. Narrow: stats stacked, then
 * one across; tablet up: a row of three above the charts, the old layout. Past 2xl the stats fold
 * into a fixed rail on the right and the charts take everything else — an ultrawide window then
 * spends its extra width on the plot rather than on a wider margin.
 */
export function StatRail({ stats, children }: { stats: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:items-start">
      <div className="order-2 min-w-0 2xl:order-1">{children}</div>
      <div className="order-1 grid gap-4 sm:grid-cols-3 2xl:order-2 2xl:grid-cols-1">{stats}</div>
    </div>
  );
}
