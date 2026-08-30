"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useT } from "./I18nProvider";

function Seg({ param, options, current }: {
  param: string;
  /** The value, its label, and the note naming what the option means once it is in effect. */
  options: [value: string, label: string, hint?: string][];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line bg-surface text-sm">
      {options.map(([val, label, hint], i) => (
        <button
          key={val}
          aria-pressed={val === current}
          // Only the selected option carries its note: it states the basis the page is
          // currently reading in, which is not true of an option you have not picked.
          title={val === current ? hint : undefined}
          onClick={() => {
            const next = new URLSearchParams(sp.toString());
            next.set(param, val);
            router.replace(`${pathname}?${next.toString()}`);
          }}
          className={`px-3 py-1 transition-colors ${i > 0 ? "border-l border-line" : ""} ${
            val === current
              ? "bg-accent text-accent-ink"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
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
    <div className="flex flex-wrap items-center gap-3">
      {/* Real and USD each need a word about the basis they convert at. That word used to sit
          beside the toggles as text that appeared and vanished with the selection, dragging the
          whole row sideways every time you switched. It hangs off the selected option now. */}
      <Seg param="value" current={modes.value} options={[
        ["real", t("mode.value.real"), baseMonth ? t("mode.inPesos", { month: baseMonth }) : undefined],
        ["nominal", t("mode.value.nominal")],
        ["usd", t("mode.value.usd"), t("mode.atMep")],
      ]} />
      {spendToggle && (
        <Seg param="spend" current={modes.spend}
          options={[["accrual", t("mode.spend.accrual")], ["cash", t("mode.spend.cash")]]} />
      )}
      {taxToggle && (
        <Seg param="tax" current={modes.tax}
          options={[["excl", t("mode.tax.excl")], ["incl", t("mode.tax.incl")]]} />
      )}
    </div>
  );
}
