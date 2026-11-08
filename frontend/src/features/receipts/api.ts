import { api, csrf } from '../../api/client';
import axios from 'axios';
export type Verification = { ok: boolean; checks: { name: string; computed: number; printed: number | null; ok: boolean }[]; errors: string[]; warnings: string[] };
export type Receipt = { id: number; revisionId: string; date: string | null; fiscalId: string | null; totalMinor: number | null; admission: string; report: Verification };
export type Product = { id: string; name: string; category: string; unit: 'un' | 'kg'; reviewed: boolean; redirectId: string | null; seq: number };
export type ReceiptDetail = { receiptId: number; revisionId: string; purchaseVersion: number | null; date: string | null; fiscalId: string | null; totalMinor: number | null; documentHash: string; report: Verification; parsed: { header: { paymentMethod: string | null; paymentCents: number | null }; footer: { subtotalCents: number | null; discountsCents: number | null } }; items: { id: string; item: { descPrinted: string; sku?: string; ean?: string; qtyMilli: number; unit: string; lineTotalCents: number; discounts: { amountCents: number; label: string }[] }; product: Product | null; match: { seq: number; productId: string; reviewed: boolean } | null }[]; link: { id: string; action: 'link' | 'unlink'; cardId: string | null; purchaseId: string | null; itemAllocations: { sourceLineId: string; accountId: string; purposeId: string; minor: number }[]; previousDecisionId: string | null } | null; history: { facts: { revisionId: string; originalRowsObject: { sha256: string }; correctedRowsObject: { sha256: string } | null }; source: { admission: string; recordedAt: string } }[] };
export type Catalog = { references?:{available:boolean;stale?:boolean;cpiLatestMonth?:string;mepLatestMonth?:string}; months?:string[]; cards: { id: string; display_name: string }[]; catalog: { id: string; type: string; posting: boolean; enabled: boolean; label_key: string | null; custom_name: string | null; primary_purpose_id: string | null; currency: string | null }[] };
// A failed transport retains this key; changed payload means a new logical command.
const pending = new Map<string, string>();
window.addEventListener('tarjetas:session-cleared', () => pending.clear());
export async function command(path: string, body: unknown, identity: string, processing = false) {
  let key = pending.get(identity); if (!key) { key = crypto.randomUUID(); pending.set(identity, key); }
  try {
    const response = await api.post(path, body, { headers: { 'Idempotency-Key': key }, timeout: processing ? 1_000_000 : 30_000 });
    pending.delete(identity); return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 419) await csrf.get('/sanctum/csrf-cookie').catch(() => {});
    // Rejection never creates a new command. An explicit change of meaning uses another identity.
    throw error;
  }
}
