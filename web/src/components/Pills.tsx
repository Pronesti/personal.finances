import Link from "next/link";

// Server-rendered pill row for granularity/period pickers — the same look /compare and
// /categories inline, shared by the pages added later.
export function Pills({ options, current, href, label, groupLabel }: {
  groupLabel?: string;
  options: readonly string[];
  current: string;
  href: (option: string) => string;
  /** Display text for an option. Period rows are dates and pass nothing; granularity rows translate. */
  label?: (option: string) => string;
}) {
  return (
    <fieldset className="mb-4 min-w-0">
      {groupLabel && <legend className="mb-2 text-xs font-semibold text-ink-muted">{groupLabel}</legend>}
      <div className="flex flex-wrap gap-1 text-sm">
      {options.map(x => (
        <Link
          key={x}
          href={href(x)}
          scroll={false}
          aria-current={x === current ? "true" : undefined}
          className={`inline-flex min-h-11 items-center rounded-lg border border-line px-3 py-2 transition-colors ${
            x === current
              ? "bg-accent text-accent-ink font-medium"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {label ? label(x) : x}
        </Link>
      ))}
      </div>
    </fieldset>
  );
}
