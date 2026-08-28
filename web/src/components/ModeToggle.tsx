"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

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
  return (
    <div className="flex flex-wrap items-center gap-3">
      {modes.value === "real" && baseMonth && (
        <span className="text-xs text-ink-subtle">in {baseMonth} pesos</span>
      )}
      {modes.value === "usd" && <span className="text-xs text-ink-subtle">at MEP</span>}
      <Seg param="value" current={modes.value}
        options={[["real", "Real $"], ["nominal", "Nominal $"], ["usd", "USD"]]} />
      {spendToggle && (
        <Seg param="spend" current={modes.spend} options={[["accrual", "Purchases"], ["cash", "As billed"]]} />
      )}
      {taxToggle && (
        <Seg param="tax" current={modes.tax} options={[["excl", "Pre-tax"], ["incl", "True cost"]]} />
      )}
    </div>
  );
}
