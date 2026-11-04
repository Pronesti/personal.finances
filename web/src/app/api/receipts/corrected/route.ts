import { selectedBackend, withAccounting } from "@/lib/backend";
import { AccountingError } from "@/lib/accounting/model";
import { ReceiptImportRejected } from "@/lib/accounting/receipt-import";
import { receiptText } from "@/lib/accounting/receipt-messages";
import { correctAccountingReceipt } from "@/lib/accounting/receipt-http";
import { getDb } from "@/lib/db";
import { ingestCorrected, ReceiptRejected } from "@/lib/receipts/ingest";
import { Failure } from "@/lib/failure";
import { getLocale } from "@/lib/locale";
import { translate } from "@/lib/i18n";

export async function POST(request: Request): Promise<Response> {
  const locale = await getLocale();
  let body: { sha256?: unknown; rowsText?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ code: "bad_rows", message: translate(locale, "failure.bad_rows"), messageKey: "failure.bad_rows" }, { status: 400 });
  }
  const sha256 = typeof body.sha256 === "string" ? body.sha256 : "";
  const rowsText = typeof body.rowsText === "string" ? body.rowsText : "";
  try {
    if(selectedBackend()==="postgres")return Response.json(await withAccounting(context=>correctAccountingReceipt(context,sha256,rowsText)));
    return Response.json(await ingestCorrected(getDb(), sha256, rowsText));
  } catch (e) {
    if(e instanceof ReceiptImportRejected)return Response.json({code:e.code,message:receiptText(locale,"accounting.receipts.verificationFailed"),...e.payload,sourceRevisionId:e.sourceRevisionId},{status:422});
    if(e instanceof AccountingError)return Response.json({code:e.code,message:receiptText(locale,"accounting.receipts.error"),receiptKey:"accounting.receipts.error"},{status:400});
    if (e instanceof ReceiptRejected)
      return Response.json(
        { code: "verification_failed", message: translate(locale, "receipts.rejected"), ...e.payload }, { status: 422 },
      );
    if (e instanceof Failure)
      return Response.json({ code: e.code, ...e.localized(locale) }, { status: 400 });
    return Response.json({ code: "ingest_failed", message: selectedBackend()==="postgres" ? receiptText(locale,"accounting.receipts.error") : (e as Error).message, receiptKey: selectedBackend()==="postgres" ? "accounting.receipts.error" : undefined }, { status: 500 });
  }
}
