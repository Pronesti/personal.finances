import type { MessageKey, Vars } from "@/lib/i18n";
import type { VerificationReport } from "@/lib/receipts/verify";
import { fmtCents } from "@/lib/receipts/money";

type T = (key: MessageKey, vars?: Vars) => string;

const CHECK_KEY: Record<VerificationReport["checks"][number]["name"], MessageKey> = {
  subtotal: "receipts.check.subtotal",
  discounts: "receipts.check.discounts",
  total: "receipts.check.total",
};

/**
 * The reconciliation report, the same markup wherever it appears. No hooks so it renders on the
 * server (detail page) and inside the client drop zone alike; the translator comes in as a prop.
 */
export function ReceiptReport({ report, t }: { report: VerificationReport; t: T }) {
  return (
    <div className="space-y-3 text-sm">
      <table className="w-full">
        <thead><tr className="border-b border-line text-left text-ink-muted">
          <th className="py-1">{t("receipts.check")}</th>
          <th className="text-right">{t("receipts.computed")}</th>
          <th className="text-right">{t("receipts.printed")}</th>
          <th className="w-8"></th>
        </tr></thead>
        <tbody>
          {report.checks.map(c => (
            <tr key={c.name} className="border-t border-line">
              <td className="py-1">{t(CHECK_KEY[c.name])}</td>
              <td className="text-right font-mono">{fmtCents(c.computed)}</td>
              <td className="text-right font-mono">{c.printed === null ? "—" : fmtCents(c.printed)}</td>
              <td className={`text-center ${c.ok ? "text-positive" : "text-negative"}`}>{c.ok ? "✓" : "✗"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.errors.length > 0 && (
        <div>
          <div className="font-medium text-negative">{t("receipts.errors")}</div>
          <ul className="list-disc pl-5">{report.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {report.offers.length > 0 && (
        <table className="w-full">
          <thead><tr className="border-b border-line text-left text-ink-muted">
            <th className="py-1">{t("receipts.offers.label")}</th>
            <th className="text-right">{t("receipts.printed")}</th>
            <th className="text-right">{t("receipts.offers.computed")}</th>
            <th className="w-8"></th>
          </tr></thead>
          <tbody>
            {report.offers.map((o, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1">{o.label}</td>
                <td className="text-right font-mono">{o.printed === null ? "—" : fmtCents(o.printed)}</td>
                <td className="text-right font-mono">{o.computed === null ? "—" : fmtCents(-o.computed)}</td>
                <td className={`text-center ${o.ok ? "text-positive" : "text-warning"}`}>{o.ok ? "✓" : "?"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.warnings.length > 0 && (
        <div>
          <div className="font-medium text-warning">{t("receipts.warnings")}</div>
          <ul className="list-disc pl-5 text-ink-muted">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
