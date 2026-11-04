"use server";
import { randomUUID } from "node:crypto";
import { selectedBackend, POSTGRES_READY_PAGES, withAccounting } from "@/lib/backend";
import { applyReview } from "@/lib/accounting/review";
import { alertModel } from "@/lib/accounting/reports/commitments";
import { loadCpi } from "@/lib/cpi";
import { loadMep } from "@/lib/mep";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { setAlertReview, type ReviewState } from "@/lib/queries";

const STATES: ReviewState[] = ["open", "reviewed", "dismissed"];

export async function reviewAlert(formData: FormData): Promise<void> {
  const key = formData.get("key");
  const state = formData.get("state");
  // typeof narrows FormDataEntryValue; the state check keeps a bad value from reaching a CHECK
  // constraint violation, which would surface as an unhandled 500 rather than a no-op.
  if (typeof key !== "string" || !key) return;
  if (typeof state !== "string" || !STATES.includes(state as ReviewState)) return;
  if (selectedBackend() === "postgres") {
    if (!POSTGRES_READY_PAGES.has("/anomalies")) return;
    await withAccounting(async ({ledger, reader}) => {
      const inspection = await reader.inspection();
      const alerts = alertModel(await reader.facts(), inspection, {cpi: loadCpi(), mep: loadMep()});
      const alert = alerts.find(alert => alert.key === key);
      if (!alert) return;
      await ledger.transaction(async tx => { if (!await tx.reviewSubject("alert", key)) await tx.appendReviewSubject({kind: "alert", id: key, state: "open", source: {kind: alert.kind, message: alert.message, expected: null, actual: alert.amount, legacyKey: `${alert.month}:${key}`}}); });
      await applyReview(ledger, {key: randomUUID(), subjectId: key, kind: "alert_state", payload: {state}, recordedAt: new Date().toISOString()});
    });
  } else setAlertReview(getDb(), key, state as ReviewState);
  revalidatePath("/anomalies");
}
