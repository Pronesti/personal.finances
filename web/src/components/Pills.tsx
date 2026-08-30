import Link from "next/link";

// A row of link pills — the granularity and period pickers. Layout-neutral on purpose: the
// caller owns the spacing, because in the page chrome this row is one line of a fixed-height
// filter bar that must not wrap.
export function Pills({ options, current, href, label }: {
  options: readonly string[];
  current: string;
  href: (option: string) => string;
  /** Display text for an option. Period rows are dates and pass nothing; granularity rows translate. */
  label?: (option: string) => string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 text-sm">
      {options.map(x => (
        <Link
          key={x}
          href={href(x)}
          className={`whitespace-nowrap rounded-md px-2 py-0.5 transition-colors ${
            x === current
              ? "bg-accent text-accent-ink font-medium"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {label ? label(x) : x}
        </Link>
      ))}
    </div>
  );
}
