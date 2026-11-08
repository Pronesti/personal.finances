// Backend-owned pure analytical routines ported from the committed reference.
const ALL_PERIOD = "all";
function periodOf(month, granularity) {
  if (granularity === "all") return ALL_PERIOD;
  if (granularity === "month") return month;
  const [y, m] = month.split("-").map(Number);
  return granularity === "quarter" ? `${y}-Q${Math.ceil(m / 3)}` : String(y);
}
function addMonth(month, n = 1) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function monthsBetween(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}
export {
  ALL_PERIOD,
  addMonth,
  monthsBetween,
  periodOf
};
