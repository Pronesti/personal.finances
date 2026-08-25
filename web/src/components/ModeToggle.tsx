"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

function Seg({ param, options, current }: { param: string; options: [string, string][]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="inline-flex rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden text-sm">
      {options.map(([val, label]) => (
        <button
          key={val}
          onClick={() => {
            const next = new URLSearchParams(sp.toString());
            next.set(param, val);
            router.replace(`${pathname}?${next.toString()}`);
          }}
          className={val === current
            ? "px-3 py-1 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "px-3 py-1 bg-transparent"}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function ModeToggle({ modes, baseMonth, spendToggle = true }: {
  modes: { spend: string; value: string; tax: string };
  baseMonth?: string;
  spendToggle?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {modes.value === "real" && baseMonth && (
        <span className="text-xs text-zinc-500">in {baseMonth} pesos</span>
      )}
      {modes.value === "usd" && <span className="text-xs text-zinc-500">at MEP</span>}
      <Seg param="value" current={modes.value}
        options={[["real", "Real $"], ["nominal", "Nominal $"], ["usd", "USD"]]} />
      {spendToggle && (
        <Seg param="spend" current={modes.spend} options={[["accrual", "Purchases"], ["cash", "As billed"]]} />
      )}
      <Seg param="tax" current={modes.tax} options={[["excl", "Pre-tax"], ["incl", "True cost"]]} />
    </div>
  );
}
