import {cycleMonth} from "@/lib/ingest";
import {loadCpi,latestMonth} from "@/lib/cpi";
import { randomUUID } from "node:crypto";
import { selectedBackend, withAccounting } from "@/lib/backend";
import { parseStatementUpload } from "@/lib/upload";
import { importStatement } from "@/lib/accounting/statement-import";
import { AccountingError } from "@/lib/accounting/model";
import { receiptText } from "@/lib/accounting/receipt-messages";
import { getDb } from "@/lib/db";
import { ingestUpload } from "@/lib/upload";
import { Failure } from "@/lib/failure";
import { getLocale } from "@/lib/locale";
import { translate } from "@/lib/i18n";

export async function POST(request: Request): Promise<Response> {
  // The drop zone renders whatever this returns, so the reader's language is settled here — the
  // pipeline itself stays monolingual and throws keys.
  const locale = await getLocale();
  const form=await request.formData();
  const file = form.get("file");
  if (!(file instanceof File))
    return Response.json(
      { code: "bad_name", message: translate(locale, "failure.noFile"), messageKey: "failure.noFile" }, { status: 400 }
    );
  try {
    if(selectedBackend()==="postgres") {
      const cardId=String(form.get("cardId")??"");
      if(!cardId.trim())return Response.json({code:"missing_card_identity",message:receiptText(locale,"accounting.receipts.cardRequired"),receiptKey:"accounting.receipts.cardRequired"},{status:400});
      const parsed=await parseStatementUpload(Buffer.from(await file.arrayBuffer()),file.name);
      const month=cycleMonth(parsed.json.period.closing_date,parsed.json.period.previous_closing_date??null),cpiStale=month>latestMonth(loadCpi());
      return await withAccounting(async context=>{
        const result=await importStatement(context.ledger,context.documents,{key:randomUUID(),cardId,filename:file.name,...parsed,recordedAt:new Date().toISOString(),appRevision:context.appRevision});
        return Response.json({...result,backend:"postgres",file:file.name,brand:parsed.json.brand,cardId,cycle_month:month,transactions:parsed.json.transactions.length,replaced:[],cpi_stale:cpiStale,alerts:result.reviews.map(r=>({kind:r.code,message:receiptText(locale,"accounting.receipts.pending")}))});
      });
    }
    return Response.json(await ingestUpload(getDb(), Buffer.from(await file.arrayBuffer()), file.name));
  } catch (e) {
    if(e instanceof AccountingError)return Response.json({code:e.code,message:receiptText(locale,"accounting.receipts.error"),receiptKey:"accounting.receipts.error"},{status:400});
    if (e instanceof Failure)
      return Response.json({ code: e.code, ...e.localized(locale) }, { status: 400 });
    // Never rethrow: Next would answer with an HTML 500 that the drop zone cannot parse.
    return Response.json({ code: "ingest_failed", message: selectedBackend()==="postgres" ? receiptText(locale,"accounting.receipts.error") : (e as Error).message, receiptKey: selectedBackend()==="postgres" ? "accounting.receipts.error" : undefined }, { status: 500 });
  }
}
