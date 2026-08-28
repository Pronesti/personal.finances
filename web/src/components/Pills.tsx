import Link from "next/link";

// Server-rendered pill row for granularity/period pickers — the same look /compare and
// /categories inline, shared by the pages added later.
export function Pills({ options, current, href }: {
  options: readonly string[];
  current: string;
  href: (option: string) => string;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 text-sm">
      {options.map(x => (
        <Link
          key={x}
          href={href(x)}
          className={`rounded-md px-2 py-0.5 transition-colors ${
            x === current
              ? "bg-accent text-accent-ink font-medium"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {x}
        </Link>
      ))}
    </div>
  );
}
