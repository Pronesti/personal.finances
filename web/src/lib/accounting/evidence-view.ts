import type { LedgerTx } from "./port";

/** Next's route params can retain percent escapes; decode exactly one URL layer. */
export function evidenceRouteId(value: string): string | null {
  if (!value || value.length > 3072) return null;
  try { const decoded = decodeURIComponent(value); return decoded && decoded.length <= 1024 ? decoded : null; }
  catch { return null; }
}

export async function evidenceView(tx: LedgerTx, id: string) {
  const revision = await tx.sourceRevision(id);
  if (revision) return { revision, line: null };
  const line = await tx.sourceLine(id);
  if (line) {
    const parent = await tx.sourceRevision(line.revisionId);
    return parent ? { revision: parent, line } : null;
  }
  // Reconstruction's opening evidence shares its journal ID and actual issuer date.
  const opening = await tx.journal(id);
  if (opening?.kind !== "opening" || !opening.evidenceIds.includes(id)) return null;
  const parent = await tx.currentStatementRevision(opening.cardId, opening.effectiveDate);
  return parent ? { revision: parent, line: null } : null;
}
