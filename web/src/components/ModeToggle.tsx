"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useT } from "./I18nProvider";

function ModeSelect({ param, options, current }: { param: "value" | "spend" | "tax"; options: [string, string][]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const t = useT();
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-ink-muted">
      <span>{t(`mode.${param}.label`)}</span>
      <select
        value={current}
        onChange={event => {
          const next = new URLSearchParams(sp.toString());
          next.set(param, event.target.value);
          router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        }}
        className="min-h-11 min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm leading-5 text-ink"
      >
        {options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
      </select>
    </label>
  );
}

export function ModeToggle({ modes, baseMonth, spendToggle = true, taxToggle = true }: {
  modes: { spend: string; value: string; tax: string };
  baseMonth?: string;
  spendToggle?: boolean;
  taxToggle?: boolean;
}) {
  const t = useT();
  return (
    <section className="mode-panel mb-6 w-full border-b border-line bg-canvas pb-3" aria-label={t("mode.help")}>
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">

      <ModeSelect param="value" current={modes.value} options={[
        ["real", t("mode.value.real")], ["nominal", t("mode.value.nominal")], ["usd", t("mode.value.usd")],
      ]} />
      {spendToggle && (
        <ModeSelect param="spend" current={modes.spend}
          options={[["accrual", t("mode.spend.accrual")], ["cash", t("mode.spend.cash")]]} />
      )}
      {taxToggle && (
        <ModeSelect param="tax" current={modes.tax}
          options={[["excl", t("mode.tax.excl")], ["incl", t("mode.tax.incl")]]} />
      )}
      <details className="mode-help relative ml-auto text-xs text-ink-muted">
        <summary title={t("mode.help")} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-accent">
          {t("mode.help.short")} <span aria-hidden="true">⌄</span>
        </summary>
        <div className="mode-help-content rounded-xl border border-line bg-surface p-4 text-sm shadow-lg">
          {modes.value === "real" && baseMonth && <p className="mb-2 font-medium text-ink">{t("mode.inPesos", { month: baseMonth })}</p>}
          {modes.value === "usd" && <p className="mb-2 font-medium text-ink">{t("mode.atMep")}</p>}
          <p className="leading-relaxed">{t("mode.help.body")}</p>
        </div>
      </details>
    </div>
    </section>
  );
}
