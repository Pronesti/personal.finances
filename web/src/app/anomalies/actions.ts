"use server";
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
  setAlertReview(getDb(), key, state as ReviewState);
  revalidatePath("/anomalies");
}
