import { selectedBackend, withAccounting } from "@/lib/backend";
import { AccountingError } from "@/lib/accounting/model";
import { ReceiptImportRejected } from "@/lib/accounting/receipt-import";
import { receiptText } from "@/lib/accounting/receipt-messages";
import { uploadAccountingReceipt } from "@/lib/accounting/receipt-http";
import { getDb } from "@/lib/db";
import { ingestReceipt, ReceiptRejected } from "@/lib/receipts/ingest";
import { Failure } from "@/lib/failure";
import { getLocale } from "@/lib/locale";
import { translate } from "@/lib/i18n";

export async function POST(request: Request): Promise<Response> {
  const locale = await getLocale();
  const file = (await request.formData()).get("file");
  if (!(file instanceof File))
    return Response.json({ code: "bad_name", message: translate(locale, "failure.noFile"), messageKey: "failure.noFile" }, { status: 400 });
  try {
    if(selectedBackend()==="postgres"){const bytes=Buffer.from(await file.arrayBuffer());return Response.json(await withAccounting(context=>uploadAccountingReceipt(context,bytes)));}
    // file.name is deliberately not passed: nothing about a receipt is in its file name.
    return Response.json(await ingestReceipt(getDb(), Buffer.from(await file.arrayBuffer())));
  } catch (e) {
    if(e instanceof ReceiptImportRejected)return Response.json({code:e.code,message:receiptText(locale,"accounting.receipts.verificationFailed"),...e.payload,sourceRevisionId:e.sourceRevisionId},{status:422});
    if(e instanceof AccountingError)return Response.json({code:e.code,message:receiptText(locale,"accounting.receipts.error"),receiptKey:"accounting.receipts.error"},{status:400});
    if (e instanceof ReceiptRejected)
      return Response.json(
        { code: "verification_failed", message: translate(locale, "receipts.rejected"), ...e.payload }, { status: 422 },
      );
    if (e instanceof Failure)
      return Response.json({ code: e.code, ...e.localized(locale) }, { status: 400 });
    // Never rethrow: Next would answer with an HTML 500 that the drop zone cannot parse.
    return Response.json({ code: "ingest_failed", message: selectedBackend()==="postgres" ? receiptText(locale,"accounting.receipts.error") : (e as Error).message, receiptKey: selectedBackend()==="postgres" ? "accounting.receipts.error" : undefined }, { status: 500 });
  }
}
