"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const links = [
  ["/", "Overview"], ["/trends", "Trends"], ["/categories", "Categories"],
  ["/recurring", "Recurring"], ["/compare", "Compare"],
] as const;

export function Nav() {
  const sp = useSearchParams();
  const qs = sp.toString();
  return (
    <nav className="flex gap-4 py-3 border-b border-zinc-200 dark:border-zinc-800 mb-6">
      {links.map(([href, label]) => (
        <Link key={href} href={qs ? `${href}?${qs}` : href} className="text-sm font-medium hover:underline">
          {label}
        </Link>
      ))}
    </nav>
  );
}
