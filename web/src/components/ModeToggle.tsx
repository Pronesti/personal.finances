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

export function ModeToggle({ spend, value, baseMonth }: { spend: string; value: string; baseMonth?: string }) {
  return (
    <div className="flex items-center gap-3">
      {value === "real" && baseMonth && (
        <span className="text-xs text-zinc-500">in {baseMonth} pesos</span>
      )}
      <Seg param="value" current={value} options={[["real", "Real $"], ["nominal", "Nominal $"]]} />
      <Seg param="spend" current={spend} options={[["accrual", "Purchases"], ["cash", "As billed"]]} />
    </div>
  );
}
