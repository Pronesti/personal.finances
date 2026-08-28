export type Granularity = "month" | "quarter" | "year";

// Collapse a YYYY-MM cycle month into the label of the period containing it. One definition,
// shared by /compare's grouping and /categories' scoping, so the two pages can never disagree
// about which quarter a month belongs to.
export function periodOf(month: string, granularity: Granularity): string {
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
