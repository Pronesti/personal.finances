import { loadCpi } from "@/lib/cpi";
import { loadMep } from "@/lib/mep";
import type { Modes } from "@/lib/scope";
import type { ValueOpts } from "@/lib/queries";

// The scope helpers live in @/lib/scope, which is pure and therefore safe in a client
// component. They are re-exported here so the pages that already import them do not care.
export {
  GRANULARITIES, MOVER_GRANULARITIES, parseGranularity, granularityLabel, periodWord, spanLabel,
  parseModes, withModes, periodsFor, resolvePeriod,
} from "@/lib/scope";
export type { SP, Modes, PeriodMode } from "@/lib/scope";

// Server-only: the single place a page assembles ValueOpts. Both tables are module-cached.
// Keep this file out of "use client" components — loadCpi/loadMep read the filesystem.
export function valueOpts(modes: Modes): ValueOpts {
  return { ...modes, cpi: loadCpi(), mep: loadMep() };
}
