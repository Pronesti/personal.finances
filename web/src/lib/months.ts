export type Granularity = "month" | "quarter" | "year" | "all";

// The single bucket "all" collapses to. It doubles as the sentinel a period picker uses for
// "do not scope", which is the same thing: one period covering every month on file.
export const ALL_PERIOD = "all";

// Collapse a YYYY-MM cycle month into the label of the period containing it. One definition,
// shared by /compare's grouping and /categories' scoping, so the two pages can never disagree
// about which quarter a month belongs to. "all" maps every month to one label, so a page that
// groups by period needs no special case to show the whole history as a single bucket.
export function periodOf(month: string, granularity: Granularity): string {
  if (granularity === "all") return ALL_PERIOD;
  if (granularity === "month") return month;
  const [y, m] = month.split("-").map(Number);
  return granularity === "quarter" ? `${y}-Q${Math.ceil(m / 3)}` : String(y);
}

export function addMonth(month: string, n = 1): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// Inclusive span: monthsBetween("2026-01", "2026-01") === 1.
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}
