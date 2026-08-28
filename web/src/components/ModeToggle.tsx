"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useT } from "./I18nProvider";

function Seg({ param, options, current }: { param: string; options: [string, string][]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line bg-surface text-sm">
      {options.map(([val, label], i) => (
        <button
          key={val}
          aria-pressed={val === current}
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
      {modes.value === "real" && baseMonth && (
        <span className="text-xs text-ink-subtle">{t("mode.inPesos", { month: baseMonth })}</span>
      )}
      {modes.value === "usd" && <span className="text-xs text-ink-subtle">{t("mode.atMep")}</span>}
      <Seg param="value" current={modes.value} options={[
        ["real", t("mode.value.real")], ["nominal", t("mode.value.nominal")], ["usd", t("mode.value.usd")],
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
